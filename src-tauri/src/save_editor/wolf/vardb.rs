//! VariableDatabase parser for Wolf RPG Editor save files.
//!
//! The VariableDatabase stores all game variables organized into "types" (tables),
//! each containing entries (rows) with fields that are either integers or strings.

use super::reader::FileWalker;

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct VariableDatabase {
    pub unknown_flag: u8,
    pub types: Vec<VarType>,
}

#[derive(Debug, Clone)]
pub struct VarType {
    pub type_unknown: i32,
    pub dis: Option<i32>,
    pub field_configs: Vec<u32>,
    pub entries: Vec<VarEntry>,
}

#[derive(Debug, Clone)]
pub struct VarEntry {
    pub fields: Vec<VarField>,
}

#[derive(Debug, Clone)]
pub enum VarField {
    Int(i32),
    Str(Vec<u8>),
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

impl VariableDatabase {
    pub fn parse(walker: &mut FileWalker) -> Result<Self, String> {
        let unknown_flag = walker.read_u8()?;
        let type_count = walker.read_u32_le()?;
        let mut types = Vec::with_capacity(type_count as usize);
        for _ in 0..type_count {
            types.push(VarType::parse(walker)?);
        }
        Ok(Self {
            unknown_flag,
            types,
        })
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.push(self.unknown_flag);
        buf.extend_from_slice(&(self.types.len() as u32).to_le_bytes());
        for vtype in &self.types {
            vtype.write_bytes(&mut buf);
        }
        buf
    }
}

impl VarType {
    pub fn parse(walker: &mut FileWalker) -> Result<Self, String> {
        let type_unknown = walker.read_i32_le()?;

        let dis = if type_unknown <= -2 {
            Some(walker.read_i32_le()?)
        } else {
            None
        };

        let field_configs = if type_unknown <= -1 {
            let field_count = walker.read_u32_le()?;
            let mut configs = Vec::with_capacity(field_count as usize);
            for _ in 0..field_count {
                configs.push(walker.read_u32_le()?);
            }
            configs
        } else {
            // type_unknown >= 0: field_count = type_unknown, all int fields
            vec![0u32; type_unknown as usize]
        };

        let type_data_count = walker.read_u32_le()?;
        let mut entries = Vec::with_capacity(type_data_count as usize);
        for _ in 0..type_data_count {
            entries.push(VarEntry::parse(walker, &field_configs)?);
        }

        Ok(Self {
            type_unknown,
            dis,
            field_configs,
            entries,
        })
    }

    fn write_bytes(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.type_unknown.to_le_bytes());

        if let Some(dis) = self.dis {
            buf.extend_from_slice(&dis.to_le_bytes());
        }

        if self.type_unknown <= -1 {
            buf.extend_from_slice(&(self.field_configs.len() as u32).to_le_bytes());
            for &config in &self.field_configs {
                buf.extend_from_slice(&config.to_le_bytes());
            }
        }
        // If type_unknown >= 0, field_configs are implicit (not written)

        buf.extend_from_slice(&(self.entries.len() as u32).to_le_bytes());
        for entry in &self.entries {
            entry.write_bytes(buf, &self.field_configs);
        }
    }
}

impl VarEntry {
    pub fn parse(walker: &mut FileWalker, field_configs: &[u32]) -> Result<Self, String> {
        let num_indices: Vec<usize> = field_configs
            .iter()
            .enumerate()
            .filter(|(_, &c)| c < 2000)
            .map(|(i, _)| i)
            .collect();
        let str_indices: Vec<usize> = field_configs
            .iter()
            .enumerate()
            .filter(|(_, &c)| c >= 2000)
            .map(|(i, _)| i)
            .collect();

        let mut fields = vec![VarField::Int(0); field_configs.len()];

        for &i in &num_indices {
            fields[i] = VarField::Int(walker.read_i32_le()?);
        }
        for &i in &str_indices {
            let data = walker.read_memdata_u32()?;
            fields[i] = VarField::Str(data.to_vec());
        }

        Ok(Self { fields })
    }

    fn write_bytes(&self, buf: &mut Vec<u8>, field_configs: &[u32]) {
        // Write numbers first (config < 2000), then strings (config >= 2000)
        for (i, &config) in field_configs.iter().enumerate() {
            if config < 2000 {
                if let VarField::Int(n) = &self.fields[i] {
                    buf.extend_from_slice(&n.to_le_bytes());
                }
            }
        }
        for (i, &config) in field_configs.iter().enumerate() {
            if config >= 2000 {
                if let VarField::Str(bytes) = &self.fields[i] {
                    buf.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
                    buf.extend_from_slice(bytes);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_all_int_type() {
        // type_unknown=2 (>=0), so field_count=2, all int configs [0,0]
        // type_data_count=1, entry: two i32 values
        let data: Vec<u8> = vec![
            0x02, 0x00, 0x00, 0x00, // type_unknown = 2
            0x01, 0x00, 0x00, 0x00, // type_data_count = 1
            0x0A, 0x00, 0x00, 0x00, // field[0] = 10
            0x14, 0x00, 0x00, 0x00, // field[1] = 20
        ];
        let mut walker = FileWalker::new(&data);
        let vtype = VarType::parse(&mut walker).unwrap();
        assert_eq!(vtype.type_unknown, 2);
        assert!(vtype.dis.is_none());
        assert_eq!(vtype.field_configs, vec![0, 0]);
        assert_eq!(vtype.entries.len(), 1);
        match &vtype.entries[0].fields[0] {
            VarField::Int(v) => assert_eq!(*v, 10),
            _ => panic!("Expected Int"),
        }
        match &vtype.entries[0].fields[1] {
            VarField::Int(v) => assert_eq!(*v, 20),
            _ => panic!("Expected Int"),
        }
    }

    #[test]
    fn parse_mixed_type_with_strings() {
        // type_unknown = -1, field_count = 2, configs = [0, 2000]
        // type_data_count = 1
        // entry: int field first (i32), then string field (u32 len + bytes)
        let data: Vec<u8> = vec![
            0xFF, 0xFF, 0xFF, 0xFF, // type_unknown = -1
            0x02, 0x00, 0x00, 0x00, // field_count = 2
            0x00, 0x00, 0x00, 0x00, // config[0] = 0 (int)
            0xD0, 0x07, 0x00, 0x00, // config[1] = 2000 (string)
            0x01, 0x00, 0x00, 0x00, // type_data_count = 1
            0x2A, 0x00, 0x00, 0x00, // int field = 42
            0x03, 0x00, 0x00, 0x00, // string len = 3
            0x41, 0x42, 0x00,       // "AB\0"
        ];
        let mut walker = FileWalker::new(&data);
        let vtype = VarType::parse(&mut walker).unwrap();
        assert_eq!(vtype.field_configs, vec![0, 2000]);
        assert_eq!(vtype.entries.len(), 1);
        match &vtype.entries[0].fields[0] {
            VarField::Int(v) => assert_eq!(*v, 42),
            _ => panic!("Expected Int"),
        }
        match &vtype.entries[0].fields[1] {
            VarField::Str(v) => assert_eq!(v, &[0x41, 0x42, 0x00]),
            _ => panic!("Expected Str"),
        }

        // Roundtrip
        let mut roundtrip_buf = Vec::new();
        vtype.write_bytes(&mut roundtrip_buf);
        assert_eq!(roundtrip_buf, data);
    }

    #[test]
    fn vardb_roundtrip() {
        // Full VarDB: unknown_flag=0, type_count=1, one simple type
        let data: Vec<u8> = vec![
            0x00,                   // unknown_flag
            0x01, 0x00, 0x00, 0x00, // type_count = 1
            0x01, 0x00, 0x00, 0x00, // type_unknown = 1 (1 int field)
            0x02, 0x00, 0x00, 0x00, // type_data_count = 2
            0x05, 0x00, 0x00, 0x00, // entry[0].field[0] = 5
            0x09, 0x00, 0x00, 0x00, // entry[1].field[0] = 9
        ];
        let mut walker = FileWalker::new(&data);
        let vardb = VariableDatabase::parse(&mut walker).unwrap();
        assert_eq!(vardb.types.len(), 1);
        assert_eq!(vardb.types[0].entries.len(), 2);

        let bytes = vardb.to_bytes();
        assert_eq!(bytes, data);
    }

    #[test]
    #[ignore] // requires real save file on disk
    fn real_save_vardb_roundtrip() {
        use super::super::crypto;

        let path = r"D:\Personalisation\Avatar\saves\Lilia The Fallen Flower in the Prison City-v1.03\Save\SaveData01.sav";
        let mut buf = std::fs::read(path).expect("Failed to read save file");

        crypto::decrypt(&mut buf);

        let mut walker = FileWalker::new(&buf);

        // Header
        walker.skip(20).unwrap();
        let marker = walker.read_u8().unwrap();
        assert_eq!(marker, 0x19);
        walker.skip_memdata_u16().unwrap();
        let version = walker.read_u16_le().unwrap();
        walker.set_file_version(version);

        // Skip SaveParts 1-5
        super::super::reader::skip_save_part_1(&mut walker).unwrap();
        super::super::reader::skip_save_part_2(&mut walker).unwrap();
        super::super::reader::skip_save_part_3(&mut walker).unwrap();
        super::super::reader::skip_save_part_4(&mut walker).unwrap();
        super::super::reader::skip_save_part_5(&mut walker).unwrap();

        let vardb_start = walker.pos();
        println!("VarDB start: 0x{:X}", vardb_start);

        let vardb = VariableDatabase::parse(&mut walker).unwrap();
        let vardb_end = walker.pos();

        println!(
            "VarDB parsed: {} types, end at 0x{:X}",
            vardb.types.len(),
            vardb_end
        );
        for (i, vtype) in vardb.types.iter().enumerate() {
            println!(
                "  Type {}: {} fields, {} entries, type_unknown={}, dis={:?}",
                i,
                vtype.field_configs.len(),
                vtype.entries.len(),
                vtype.type_unknown,
                vtype.dis
            );
        }

        // Serialize back and compare bytes
        let serialized = vardb.to_bytes();
        let original_slice = &buf[vardb_start..vardb_end];
        assert_eq!(
            serialized.len(),
            original_slice.len(),
            "Serialized length {} != original length {}",
            serialized.len(),
            original_slice.len()
        );
        assert_eq!(
            serialized, original_slice,
            "Serialized bytes don't match original"
        );
        println!("Roundtrip OK: {} bytes match", serialized.len());
    }
}

//! Binary cursor for reading sequential fields from Wolf RPG Editor save data,
//! plus functions to skip each SavePart structure.
//!
//! Translated from the C++ WolfSave project by Sinflower:
//! https://github.com/Sinflower/WolfSave

// ---------------------------------------------------------------------------
// FileWalker
// ---------------------------------------------------------------------------

pub struct FileWalker<'a> {
    data: &'a [u8],
    pos: usize,
    file_version: u16,
}

impl<'a> FileWalker<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Self {
            data,
            pos: 0,
            file_version: 0,
        }
    }

    pub fn pos(&self) -> usize {
        self.pos
    }

    #[allow(dead_code)]
    pub fn remaining(&self) -> usize {
        self.data.len().saturating_sub(self.pos)
    }

    pub fn set_file_version(&mut self, v: u16) {
        self.file_version = v;
    }

    pub fn file_version(&self) -> u16 {
        self.file_version
    }

    // -- primitive reads ----------------------------------------------------

    pub fn read_u8(&mut self) -> Result<u8, String> {
        if self.pos >= self.data.len() {
            return Err(format!(
                "read_u8: EOF at pos 0x{:X} (len 0x{:X})",
                self.pos,
                self.data.len()
            ));
        }
        let v = self.data[self.pos];
        self.pos += 1;
        Ok(v)
    }

    pub fn read_u16_le(&mut self) -> Result<u16, String> {
        let b = self.read_bytes(2)?;
        Ok(u16::from_le_bytes([b[0], b[1]]))
    }

    pub fn read_u32_le(&mut self) -> Result<u32, String> {
        let b = self.read_bytes(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    pub fn read_i32_le(&mut self) -> Result<i32, String> {
        let b = self.read_bytes(4)?;
        Ok(i32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    #[allow(dead_code)]
    pub fn read_u64_le(&mut self) -> Result<u64, String> {
        let b = self.read_bytes(8)?;
        Ok(u64::from_le_bytes([
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
        ]))
    }

    pub fn read_bytes(&mut self, n: usize) -> Result<&'a [u8], String> {
        if self.pos + n > self.data.len() {
            return Err(format!(
                "read_bytes({}): EOF at pos 0x{:X} (len 0x{:X})",
                n,
                self.pos,
                self.data.len()
            ));
        }
        let slice = &self.data[self.pos..self.pos + n];
        self.pos += n;
        Ok(slice)
    }

    // -- MemData reads (length-prefixed byte arrays) ------------------------

    /// Read a MemData<WORD>: u16 length prefix, then `length` bytes.
    #[allow(dead_code)]
    pub fn read_memdata_u16(&mut self) -> Result<&'a [u8], String> {
        let len = self.read_u16_le()? as usize;
        if len == 0 {
            return Ok(&[]);
        }
        self.read_bytes(len)
    }

    /// Read a MemData<DWORD>: u32 length prefix, then `length` bytes.
    pub fn read_memdata_u32(&mut self) -> Result<&'a [u8], String> {
        let len = self.read_u32_le()? as usize;
        if len == 0 {
            return Ok(&[]);
        }
        self.read_bytes(len)
    }

    // -- skip helpers -------------------------------------------------------

    pub fn skip(&mut self, n: usize) -> Result<(), String> {
        if self.pos + n > self.data.len() {
            return Err(format!(
                "skip({}): EOF at pos 0x{:X} (len 0x{:X})",
                n,
                self.pos,
                self.data.len()
            ));
        }
        self.pos += n;
        Ok(())
    }

    pub fn skip_memdata_u16(&mut self) -> Result<(), String> {
        let len = self.read_u16_le()? as usize;
        if len > 0 {
            self.skip(len)?;
        }
        Ok(())
    }

    pub fn skip_memdata_u32(&mut self) -> Result<(), String> {
        let len = self.read_u32_le()? as usize;
        if len > 0 {
            self.skip(len)?;
        }
        Ok(())
    }

    /// Peek at a byte at absolute offset without advancing.
    #[allow(dead_code)]
    pub fn peek_u8_at(&self, offset: usize) -> Result<u8, String> {
        if offset >= self.data.len() {
            return Err(format!(
                "peek_u8_at(0x{:X}): out of bounds (len 0x{:X})",
                offset,
                self.data.len()
            ));
        }
        Ok(self.data[offset])
    }

    /// Seek to an absolute position.
    pub fn seek(&mut self, pos: usize) -> Result<(), String> {
        if pos > self.data.len() {
            return Err(format!(
                "seek(0x{:X}): out of bounds (len 0x{:X})",
                pos,
                self.data.len()
            ));
        }
        self.pos = pos;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// SavePart skip functions
// ---------------------------------------------------------------------------

/// Skip SavePart1_1_1_1 (innermost nested struct of SavePart1).
fn skip_save_part1_1_1_1(w: &mut FileWalker) -> Result<(), String> {
    // m_var1: u8
    w.skip(1)?;
    // m_var2: u8 (count for m_vars1: vec of u32)
    let var2 = w.read_u8()? as u32;
    w.skip(var2 as usize * 4)?; // m_vars1
    // m_var3: u8 (count for m_vars2: vec of u8)
    let var3 = w.read_u8()? as u32;
    w.skip(var3 as usize)?; // m_vars2
    Ok(())
}

/// Skip SavePart1_1_1.
fn skip_save_part1_1_1(w: &mut FileWalker) -> Result<(), String> {
    // 6 bytes: var1..var6
    w.skip(6)?;
    // m_var7: u32 count
    let var7 = w.read_u32_le()?;
    if var7 > 0x10000 {
        return Err(format!(
            "skip_save_part1_1_1: var7={} exceeds 0x10000 at pos 0x{:X}",
            var7,
            w.pos()
        ));
    }
    for _ in 0..var7 {
        skip_save_part1_1_1_1(w)?;
    }
    Ok(())
}

/// Skip SavePart1_1 (the sub-object used in SavePart1 and SavePart4).
pub fn skip_save_part1_1(w: &mut FileWalker) -> Result<(), String> {
    let ver = w.file_version();

    // m_var1..m_var4: 4x u32
    w.skip(16)?;
    // m_var5: u8
    w.skip(1)?;
    // m_var6: u32
    w.skip(4)?;

    // m_md1: MemData<WORD>
    w.skip_memdata_u16()?;

    // m_var7..m_var10: 4x u16
    w.skip(8)?;
    // m_var11..m_var12: 2x u8
    w.skip(2)?;

    // m_sp1, m_sp2: two SavePart1_1_1
    skip_save_part1_1_1(w)?;
    skip_save_part1_1_1(w)?;

    // m_var13..m_var18: 6x u16
    w.skip(12)?;
    // m_var19..m_var21: 3x u8
    w.skip(3)?;

    // m_var22: u32 (count for m_vars1: vec of u32)
    let var22 = w.read_u32_le()?;
    if (var22 as i32) > 0 {
        w.skip(var22 as usize * 4)?;
    }

    if ver >= 0x70 {
        // m_var23, m_var24: 2x u8
        w.skip(2)?;
    }

    if ver >= 0x73 {
        // m_var25..m_var28: 4x u32
        w.skip(16)?;
    }

    if ver >= 0x78 {
        // m_var29: u32
        w.skip(4)?;
    }

    if ver >= 0x85 {
        // m_var30..m_var32: 3x u32
        w.skip(12)?;
    }

    if ver >= 0x8A {
        // m_var33: u16 (count for m_mds1: vec of MemData<WORD>)
        let var33 = w.read_u16_le()?;
        if (var33 as i16) > 0 {
            for _ in 0..var33 {
                w.skip_memdata_u16()?;
            }
        }
        // m_var34: u32, m_var35: u8, m_var36: u32, m_var37: u32
        w.skip(4)?; // var34
        w.skip(1)?; // var35
        w.skip(4)?; // var36
        w.skip(4)?; // var37
    }

    if ver >= 0x8B {
        // m_var38: u32
        w.skip(4)?;
    }

    if ver >= 0x8C {
        // m_var39: u32
        w.skip(4)?;
    }

    Ok(())
}

/// Skip SavePart1.
pub fn skip_save_part_1(w: &mut FileWalker) -> Result<(), String> {
    let ver = w.file_version();
    if ver == 0 {
        return Err("skip_save_part_1: file_version not set".into());
    }

    // m_var1..m_var3: 3x u32
    w.skip(12)?;

    if ver >= 0x69 {
        // m_var4: u32, m_var5: u32
        let var4 = w.read_u32_le()?;
        let var5 = w.read_u32_le()?;
        // m_var6: u32 (peek — if != -1 (0xFFFFFFFF), rewind and read grid)
        let var6 = w.read_u32_le()?;
        if var6 != 0xFFFFFFFF {
            // Revert the 4-byte read (seek back)
            w.seek(w.pos() - 4)?;
            // 3 * var4 * var5 DWORDs
            let count = 3u64 * var4 as u64 * var5 as u64;
            w.skip(count as usize * 4)?;
        }
    }

    // m_md1: MemData<DWORD>
    w.skip_memdata_u32()?;

    // v140 dynamic count of MemData<DWORD>
    let v140: u32 = if ver >= 0x8A {
        31
    } else if ver >= 0x73 {
        15
    } else {
        7
    };
    for _ in 0..v140 {
        w.skip_memdata_u32()?;
    }

    // m_var7: u32 (count)
    let var7 = w.read_u32_le()?;
    if (var7 as i32) > 0 {
        if ver >= 0x64 {
            // m_vars2New: vec of u32
            w.skip(var7 as usize * 4)?;
        } else {
            // m_vars2Old: vec of u8
            w.skip(var7 as usize)?;
        }
    }

    // m_var8: u32 (count for SavePart1_1 array)
    let var8 = w.read_u32_le()?;
    if (var8 as i32) > 0 {
        for _ in 0..var8 {
            skip_save_part1_1(w)?;
        }
    }

    if ver >= 0x72 {
        // m_var9..m_var19: 11x u32
        w.skip(44)?;
    }

    // m_var20: u32 (count for m_vars3)
    let var20 = w.read_u32_le()?;
    if (var20 as i32) > 0 {
        w.skip(var20 as usize * 4)?;
    }

    Ok(())
}

/// Skip SavePart2.
pub fn skip_save_part_2(w: &mut FileWalker) -> Result<(), String> {
    let ver = w.file_version();
    if ver == 0 {
        return Err("skip_save_part_2: file_version not set".into());
    }

    // m_var1, m_var2: 2x u8
    w.skip(2)?;
    // m_var3..m_var21: 19x u32
    w.skip(76)?;
    // m_var22..m_var24: 3x u16
    w.skip(6)?;
    // m_var25: u32
    w.skip(4)?;
    // m_var26..m_var28: 3x u16
    w.skip(6)?;
    // m_var29..m_var37: 9x u32
    w.skip(36)?;
    // m_var38: u8
    w.skip(1)?;
    // m_var39: u16
    w.skip(2)?;
    // m_var40, m_var41: 2x u32
    w.skip(8)?;
    // m_var42..m_var45: 4x u16
    w.skip(8)?;
    // m_var46..m_var48: 3x u32
    w.skip(12)?;
    // m_var49: u8
    w.skip(1)?;

    if ver <= 96 {
        // m_var50: u32
        w.skip(4)?;
    }

    // m_var51: u32
    w.skip(4)?;

    if ver >= 98 {
        // m_var52, m_var53: 2x u32
        w.skip(8)?;
    }

    if ver >= 100 {
        // m_var54, m_var55: 2x u32; m_var56: u8
        w.skip(9)?;

        // m_var57: u32 (count for mds1)
        let var57 = w.read_u32_le()?;
        if (var57 as i32) > 0 {
            for _ in 0..var57 {
                w.skip_memdata_u32()?;
            }
        }

        // m_var58: u32 (count for vars1)
        let var58 = w.read_u32_le()?;
        if (var58 as i32) > 0 {
            w.skip(var58 as usize * 4)?;
        }

        // m_var59..m_var63: 5x u32
        w.skip(20)?;
    }

    if ver >= 101 {
        // m_var64..m_var69: 6x u32
        w.skip(24)?;
    }

    if ver >= 102 {
        // m_var70: u16
        w.skip(2)?;
    }

    if ver >= 103 {
        // m_md1, m_md2: 2x MemData<WORD>
        w.skip_memdata_u16()?;
        w.skip_memdata_u16()?;
    }

    if ver >= 104 {
        // m_var71: u32
        w.skip(4)?;
    }

    if ver >= 106 {
        // m_var72..m_var74: 3x u32
        w.skip(12)?;
    }

    if ver >= 108 {
        // m_md3: MemData<WORD>
        w.skip_memdata_u16()?;
        // m_var75..m_var77: 3x u32
        w.skip(12)?;
        // m_md4: MemData<WORD>
        w.skip_memdata_u16()?;
        // m_var78..m_var80: 3x u32
        w.skip(12)?;
    }

    if ver >= 109 {
        // m_md5, m_md6: 2x MemData<WORD>
        w.skip_memdata_u16()?;
        w.skip_memdata_u16()?;
        // m_var81: u8
        w.skip(1)?;
    }

    if ver >= 110 {
        // m_var82: u8
        w.skip(1)?;
    }

    if ver >= 119 {
        // m_md7, m_md8, m_md9: 3x MemData<WORD>
        w.skip_memdata_u16()?;
        w.skip_memdata_u16()?;
        w.skip_memdata_u16()?;
    }

    if ver >= 121 {
        w.skip(4)?; // m_var83
    }
    if ver >= 122 {
        w.skip(4)?; // m_var84
    }
    if ver >= 124 {
        w.skip(4)?; // m_var85
    }
    if ver >= 126 {
        w.skip(4)?; // m_var86
    }
    if ver >= 128 {
        w.skip(4)?; // m_var87
    }
    if ver >= 129 {
        w.skip(8)?; // m_var88, m_var89
    }
    if ver >= 130 {
        w.skip(4)?; // m_var90
    }
    if ver >= 131 {
        w.skip(4)?; // m_var91
    }
    if ver >= 132 {
        w.skip(16)?; // m_var92..m_var95
    }
    if ver >= 134 {
        w.skip(1)?; // m_var96
    }
    if ver >= 136 {
        w.skip(1)?; // m_var97
    }

    if ver >= 137 {
        // m_var98..m_var101: 4x u32
        w.skip(16)?;
        // m_vars2: 2 iterations * 12 DWORDs each = 24 DWORDs
        w.skip(24 * 4)?;
    }

    if ver >= 0x8A {
        // m_var102..m_var105: 4x u32
        w.skip(16)?;
        // m_md10: MemData<DWORD>
        w.skip_memdata_u32()?;
        // m_var106: u32 (count for mds2)
        let var106 = w.read_u32_le()?;
        if (var106 as i32) > 0 {
            for _ in 0..var106 {
                w.skip_memdata_u32()?;
            }
        }
    }

    if ver < 0x8D {
        return Ok(());
    }

    // m_var107..m_var120: 14x u8
    w.skip(14)?;
    // m_bytes: fixed array of 0x100 bytes
    w.skip(0x100)?;
    // m_var121, m_var122: 2x u8
    w.skip(2)?;

    if ver < 0x8E {
        return Ok(());
    }

    // m_var123: u32
    w.skip(4)?;

    Ok(())
}

/// Skip SavePart3.
pub fn skip_save_part_3(w: &mut FileWalker) -> Result<(), String> {
    let ver = w.file_version();
    if ver == 0 {
        return Err("skip_save_part_3: file_version not set".into());
    }

    // m_var1: u32
    w.skip(4)?;

    // m_var2: u32 (outer count)
    let var2 = w.read_u32_le()?;

    // The C++ code checks `(int)m_var2 >= 0` which is always true for u32,
    // but the semantics is "if var2 is a valid non-negative count".
    if (var2 as i32) < 0 {
        return Ok(());
    }

    for _ in 0..var2 {
        // v1: u32 (inner count)
        let v1 = w.read_u32_le()?;
        if (v1 as i32) < 0 {
            return Err(format!(
                "skip_save_part_3: negative inner count v1={} at 0x{:X}",
                v1,
                w.pos()
            ));
        }
        for _ in 0..v1 {
            // v2: u8 (count for inner-inner u32 values)
            let v2 = w.read_u8()?;
            w.skip(v2 as usize * 4)?;
        }
    }

    // m_var3: u32
    let var3 = w.read_u32_le()?;
    if var3 > 0x270F {
        // C++ returns true (no more parsing)
        return Ok(());
    }

    if (var3 as i32) > 0 {
        for _ in 0..var3 {
            let v = w.read_u32_le()?;
            if (v as i32) < 0 {
                return Err(format!(
                    "skip_save_part_3: negative count v={} at 0x{:X}",
                    v,
                    w.pos()
                ));
            }
            w.skip(v as usize * 4)?;
        }
    }

    // m_var4: u32
    let var4 = w.read_u32_le()?;
    if (var4 as i32) < 0 {
        return Ok(());
    }

    for _ in 0..var4 {
        if ver < 0x6F {
            w.skip_memdata_u16()?;
        } else {
            w.skip_memdata_u32()?;
        }
    }

    // m_var5: u32
    let var5 = w.read_u32_le()?;
    if (var5 as i32) < 0 || var5 > 10000 {
        return Err(format!(
            "skip_save_part_3: var5={} out of range at 0x{:X}",
            var5,
            w.pos()
        ));
    }

    for _ in 0..var5 {
        let v = w.read_u8()?;
        w.skip(v as usize * 4)?;
    }

    // m_var6: u32
    let var6 = w.read_u32_le()?;
    if var6 > 10000 {
        return Ok(());
    }
    if (var6 as i32) <= 0 {
        return Ok(());
    }

    for _ in 0..var6 {
        let v = w.read_u8()?;
        if v > 0 {
            for _ in 0..v {
                if ver < 0x6F {
                    w.skip_memdata_u16()?;
                } else {
                    w.skip_memdata_u32()?;
                }
            }
        }
    }

    Ok(())
}

/// Skip SavePart4.
pub fn skip_save_part_4(w: &mut FileWalker) -> Result<(), String> {
    let ver = w.file_version();
    if ver == 0 {
        return Err("skip_save_part_4: file_version not set".into());
    }

    // First: one SavePart1_1 inline
    skip_save_part1_1(w)?;

    // m_var1: u32 (count for SavePart1_1 array)
    let var1 = w.read_u32_le()?;
    for _ in 0..var1 {
        skip_save_part1_1(w)?;
    }

    // m_var2: u8, m_var3: u8
    w.skip(2)?;

    // m_var4: u32 (count for m_vars1: vec of u32)
    let var4 = w.read_u32_le()?;
    if (var4 as i32) > 0 {
        w.skip(var4 as usize * 4)?;
    }

    if ver < 0x8A {
        return Ok(());
    }

    // m_var5: u32 (count for m_vars2: vec of u64)
    let var5 = w.read_u32_le()?;
    if (var5 as i32) > 0 {
        w.skip(var5 as usize * 8)?;
    }

    Ok(())
}

/// Skip SavePart5_1 (sub-object of SavePart5).
fn skip_save_part5_1(w: &mut FileWalker) -> Result<(), String> {
    let ver = w.file_version();

    // m_var1: u32
    w.skip(4)?;

    // m_var2: u8, m_var3: u8, m_var4: u16, m_var5: u8, m_var6: u8
    w.skip(6)?;

    // m_md1: MemData<WORD>
    w.skip_memdata_u16()?;

    // m_var7, m_var8: 2x u32
    w.skip(8)?;
    // m_var9, m_var10: 2x u32
    w.skip(8)?;
    // m_var11..m_var18: 8x u32
    w.skip(32)?;

    // m_vals1: fixed 2*3 = 6 DWORDs
    w.skip(24)?;

    if ver >= 0x69 {
        // m_var19..m_var36: 18x u32
        w.skip(72)?;
    }

    if ver >= 0x6B {
        // m_var37: u8
        w.skip(1)?;
    }

    if ver >= 0x72 {
        // m_var38: u8, m_var39: u8
        w.skip(2)?;
        // m_vals2: 4x u32
        w.skip(16)?;
        // m_vals3: 4x u32
        w.skip(16)?;
    }

    if ver >= 0x73 {
        // m_var40..m_var43: 4x u32
        w.skip(16)?;

        if ver >= 0x74 {
            // m_var44..m_var48: 5x u32
            w.skip(20)?;
        }

        if ver >= 0x75 {
            // m_var49..m_var54: 6x u32
            w.skip(24)?;
        }

        // m_var55..m_var60: 6x u32
        w.skip(24)?;
    }

    if ver >= 0x76 {
        // m_var61..m_var63: 3x u32
        w.skip(12)?;
    }

    if ver < 0x81 {
        return Ok(());
    }

    // m_var64..m_var69: 6x u32
    w.skip(24)?;

    // m_var70..m_var84: 15x u32
    w.skip(60)?;

    if ver >= 0x87 {
        // m_var85..m_var89: 5x u32
        w.skip(20)?;
    }

    if ver >= 0x89 {
        // m_var90: u32 (count)
        let var90 = w.read_u32_le()?;
        if (var90 as i32) > 0 {
            for _ in 0..var90 {
                // v: u32 (inner count)
                let v = w.read_u32_le()?;
                if (v as i32) > 0 {
                    w.skip(v as usize * 4)?;
                }
            }
        }

        // m_var91..m_var97: 7x u32
        w.skip(28)?;
    }

    Ok(())
}

/// Skip SavePart5.
pub fn skip_save_part_5(w: &mut FileWalker) -> Result<(), String> {
    let ver = w.file_version();
    if ver == 0 {
        return Err("skip_save_part_5: file_version not set".into());
    }

    // m_var1: u16
    let var1 = w.read_u16_le()?;
    if (var1 & 0x8000) == 0 {
        for _ in 0..var1 {
            skip_save_part5_1(w)?;
        }
    }

    Ok(())
}

/// Skip SavePart7.
#[allow(dead_code)]
pub fn skip_save_part_7(w: &mut FileWalker) -> Result<(), String> {
    let ver = w.file_version();
    if ver == 0 {
        return Err("skip_save_part_7: file_version not set".into());
    }

    // m_var1: u8
    let var1 = w.read_u8()?;
    if var1 != 1 {
        return Ok(());
    }

    // m_var2: u32 (count)
    let var2 = w.read_u32_le()?;

    for _ in 0..var2 {
        let v = w.read_u8()?;
        if v < 0xFA {
            // BYTE follow-up
            w.skip(1)?;
        } else {
            // DWORD follow-up
            w.skip(4)?;
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_walker_basic_reads() {
        let data: Vec<u8> = vec![
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A,
        ];
        let mut w = FileWalker::new(&data);
        assert_eq!(w.remaining(), 10);
        assert_eq!(w.read_u8().unwrap(), 0x01);
        assert_eq!(w.read_u16_le().unwrap(), 0x0302);
        assert_eq!(w.read_u32_le().unwrap(), 0x07060504);
        assert_eq!(w.remaining(), 3);
    }

    #[test]
    fn file_walker_memdata() {
        // MemData<WORD>: length=3, then 3 bytes of data
        let data: Vec<u8> = vec![0x03, 0x00, 0xAA, 0xBB, 0xCC];
        let mut w = FileWalker::new(&data);
        let md = w.read_memdata_u16().unwrap();
        assert_eq!(md, &[0xAA, 0xBB, 0xCC]);
        assert_eq!(w.remaining(), 0);
    }

    #[test]
    fn file_walker_skip_memdata() {
        let data: Vec<u8> = vec![0x02, 0x00, 0xFF, 0xFF, 0x42];
        let mut w = FileWalker::new(&data);
        w.skip_memdata_u16().unwrap();
        assert_eq!(w.pos(), 4);
        assert_eq!(w.read_u8().unwrap(), 0x42);
    }

    #[test]
    fn file_walker_eof_error() {
        let data: Vec<u8> = vec![0x01];
        let mut w = FileWalker::new(&data);
        assert!(w.read_u16_le().is_err());
    }

    #[test]
    #[ignore] // requires real save file on disk
    fn real_save_skip_all_parts() {
        use super::super::crypto;
        use super::super::tree::{HEADER_SIZE, SAVE_MARKER};

        let path = r"D:\Personalisation\Avatar\saves\Lilia The Fallen Flower in the Prison City-v1.03\Save\SaveData01.sav";
        let mut buf = std::fs::read(path).expect("Failed to read save file");

        // Decrypt
        crypto::decrypt(&mut buf);

        let mut w = FileWalker::new(&buf);

        // Skip file header
        w.skip(HEADER_SIZE).unwrap();
        println!("After header: pos=0x{:X}", w.pos());

        // Marker byte
        let marker = w.read_u8().unwrap();
        assert_eq!(marker, SAVE_MARKER, "Expected 0x{:02X} marker, got 0x{:02X}", SAVE_MARKER, marker);
        println!("After marker: pos=0x{:X}", w.pos());

        // Game name: MemData<WORD>
        w.skip_memdata_u16().unwrap();
        println!("After game name: pos=0x{:X}", w.pos());

        // File version: u16
        let version = w.read_u16_le().unwrap();
        w.set_file_version(version);
        println!(
            "File version: 0x{:X}, after version: pos=0x{:X}",
            version,
            w.pos()
        );

        // Skip all SaveParts
        skip_save_part_1(&mut w).unwrap();
        println!("After SavePart1: pos=0x{:X}", w.pos());

        skip_save_part_2(&mut w).unwrap();
        println!("After SavePart2: pos=0x{:X}", w.pos());

        skip_save_part_3(&mut w).unwrap();
        println!("After SavePart3: pos=0x{:X}", w.pos());

        skip_save_part_4(&mut w).unwrap();
        println!("After SavePart4: pos=0x{:X}", w.pos());

        skip_save_part_5(&mut w).unwrap();
        println!("After SavePart5: pos=0x{:X}", w.pos());

        // VariableDatabase would go here — skip for now, just report position
        println!(
            "VariableDB start: pos=0x{:X}, remaining={}",
            w.pos(),
            w.remaining()
        );

        // We cannot skip the VarDB yet (Task 3), so just verify we're
        // well past the halfway point of the file and didn't error out.
        assert!(
            w.pos() > buf.len() / 4,
            "Expected to be past 25% of file after 5 SaveParts, pos=0x{:X}, len=0x{:X}",
            w.pos(),
            buf.len()
        );
    }
}

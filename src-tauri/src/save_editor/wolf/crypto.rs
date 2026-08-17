//! Wolf RPG Editor save encryption (MSVC rand XOR).
//!
//! Adapted from [Prismatic](https://github.com/Patrick-Batenburg/prismatic) (GPL-3.0),
//! originally based on [WolfSave](https://github.com/Sinflower/WolfSave) (MIT).

/// MSVC rand() LCG PRNG — exact replication of the Visual C++ runtime.
struct MsvcRng {
    state: u32,
}

impl MsvcRng {
    fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    fn next(&mut self) -> u32 {
        self.state = self.state.wrapping_mul(214013).wrapping_add(2531011);
        (self.state >> 16) & 0x7FFF
    }
}

/// The three XOR passes used by Wolf RPG Editor saves.
/// Each pass has: (seed_offset into the header, step increment).
const DECRYPT_PASSES: [(usize, usize); 3] = [
    (0x00, 1), // seed=buf[0], every byte
    (0x03, 2), // seed=buf[3], every 2nd byte
    (0x09, 5), // seed=buf[9], every 5th byte
];

/// Encrypt passes are the reverse order of decrypt passes.
const ENCRYPT_PASSES: [(usize, usize); 3] = [
    (0x09, 5),
    (0x03, 2),
    (0x00, 1),
];

const DATA_OFFSET: usize = 0x14;

fn xor_pass(buf: &mut [u8], seed: u32, increment: usize) {
    let data = &mut buf[DATA_OFFSET..];
    let mut rng = MsvcRng::new(seed);
    let mut i = 0;
    while i < data.len() {
        let xor_val = (rng.next() >> 12) as u8;
        data[i] ^= xor_val;
        i += increment;
    }
}

/// Decrypt a Wolf RPG Editor save buffer in-place.
/// The buffer must contain the full file (header + data).
pub fn decrypt(buf: &mut [u8]) {
    if buf.len() <= DATA_OFFSET {
        return;
    }
    for &(seed_offset, increment) in &DECRYPT_PASSES {
        let seed = buf[seed_offset] as u32;
        xor_pass(buf, seed, increment);
    }
}

/// Encrypt a Wolf RPG Editor save buffer in-place.
/// The buffer must contain the full file (header + data).
pub fn encrypt(buf: &mut [u8]) {
    if buf.len() <= DATA_OFFSET {
        return;
    }
    for &(seed_offset, increment) in &ENCRYPT_PASSES {
        let seed = buf[seed_offset] as u32;
        xor_pass(buf, seed, increment);
    }
}

/// Compute the additive checksum over the data region (offset 0x14 onward).
/// Wolf RPG Editor stores this at buf[0x02].
pub fn checksum(buf: &[u8]) -> u8 {
    if buf.len() <= DATA_OFFSET {
        return 0;
    }
    buf[DATA_OFFSET..]
        .iter()
        .fold(0u8, |acc, &b| acc.wrapping_add(b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn msvc_rng_known_values() {
        // Known MSVC rand() sequence with seed 0
        let mut rng = MsvcRng::new(0);
        assert_eq!(rng.next(), 38);
        assert_eq!(rng.next(), 7719);
        assert_eq!(rng.next(), 21238);
        assert_eq!(rng.next(), 2437);
        assert_eq!(rng.next(), 8855);
    }

    #[test]
    fn msvc_rng_seed_1() {
        // Known MSVC rand() sequence with seed 1
        let mut rng = MsvcRng::new(1);
        assert_eq!(rng.next(), 41);
        assert_eq!(rng.next(), 18467);
        assert_eq!(rng.next(), 6334);
        assert_eq!(rng.next(), 26500);
        assert_eq!(rng.next(), 19169);
    }

    #[test]
    fn decrypt_then_encrypt_roundtrip() {
        // Create a fake save buffer with enough data
        let mut original = vec![0u8; 0x100];
        // Fill header bytes used as seeds
        original[0x00] = 0x51;
        original[0x03] = 0x75;
        original[0x09] = 0x12;
        // Fill data region with recognizable pattern
        for (i, b) in original[DATA_OFFSET..].iter_mut().enumerate() {
            *b = (i & 0xFF) as u8;
        }
        let mut buf = original.clone();

        decrypt(&mut buf);
        // Should be different after decryption
        assert_ne!(buf[DATA_OFFSET..], original[DATA_OFFSET..]);

        encrypt(&mut buf);
        // Should be back to original
        assert_eq!(buf, original);
    }

    #[test]
    fn encrypt_then_decrypt_roundtrip() {
        let mut original = vec![0u8; 0x100];
        original[0x00] = 0xAB;
        original[0x03] = 0xCD;
        original[0x09] = 0xEF;
        for (i, b) in original[DATA_OFFSET..].iter_mut().enumerate() {
            *b = ((i * 7 + 13) & 0xFF) as u8;
        }
        let mut buf = original.clone();

        encrypt(&mut buf);
        assert_ne!(buf[DATA_OFFSET..], original[DATA_OFFSET..]);

        decrypt(&mut buf);
        assert_eq!(buf, original);
    }

    #[test]
    fn checksum_calculation() {
        let mut buf = vec![0u8; 0x20];
        // Data region starts at 0x14, so bytes 0x14..0x20
        buf[0x14] = 10;
        buf[0x15] = 20;
        buf[0x16] = 30;
        buf[0x17] = 200;
        // 10 + 20 + 30 + 200 = 260, wrapping to 4
        assert_eq!(checksum(&buf), 4);
    }

    #[test]
    fn checksum_empty_data() {
        let buf = vec![0u8; DATA_OFFSET];
        assert_eq!(checksum(&buf), 0);
    }

    #[test]
    #[ignore] // requires real save file on disk
    fn real_save_file_roundtrip() {
        let path = r"D:\Personalisation\Avatar\saves\Lilia The Fallen Flower in the Prison City-v1.03\Save\SaveData01.sav";
        let original = std::fs::read(path).expect("Failed to read save file");
        let mut buf = original.clone();

        // Decrypt
        decrypt(&mut buf);

        // After decryption, byte at DATA_OFFSET should be the 0x19 marker
        assert_eq!(
            buf[DATA_OFFSET], 0x19,
            "Expected 0x19 marker at offset 0x14 after decryption, got 0x{:02X}",
            buf[DATA_OFFSET]
        );

        // Checksum of decrypted data should match byte[2]
        let cs = checksum(&buf);
        assert_eq!(
            cs, buf[0x02],
            "Checksum mismatch: computed 0x{:02X}, stored 0x{:02X}",
            cs, buf[0x02]
        );

        // Re-encrypt should give back the original
        encrypt(&mut buf);
        assert_eq!(buf, original, "Re-encrypted data doesn't match original");
    }
}

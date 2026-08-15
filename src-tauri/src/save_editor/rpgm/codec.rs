use crate::error::AppError;

pub fn decompress_rpgsave(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    let wide = lz_str::decompress_from_base64(trimmed)
        .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
    String::from_utf16(&wide).map_err(|_| AppError::keyed("error.saveEditor.parse"))
}

pub fn compress_rpgsave(json_text: &str) -> Result<String, AppError> {
    Ok(lz_str::compress_to_base64(json_text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_small_json() {
        let json = r#"{"party":{"_gold":123}}"#;
        let compressed = compress_rpgsave(json).unwrap();
        assert!(compressed.starts_with('N') || compressed.len() > 8);
        let out = decompress_rpgsave(&compressed).unwrap();
        assert_eq!(out, json);
    }

    #[test]
    fn rejects_garbage() {
        let err = decompress_rpgsave("!!!not-lz!!!").unwrap_err();
        assert!(err.to_string().contains("error.saveEditor.parse"));
    }
}

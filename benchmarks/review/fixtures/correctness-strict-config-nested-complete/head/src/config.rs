use serde::Deserialize;

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub rules: Vec<RuleConfig>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuleConfig {
    pub name: String,
    pub naming: Option<NamingOptions>,
    pub length: Option<LengthOptions>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NamingOptions {
    pub pattern: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LengthOptions {
    pub max: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fails(json: &str) -> bool {
        serde_json::from_str::<Config>(json).is_err()
    }

    #[test]
    fn rejects_unknown_keys_at_every_level() {
        assert!(fails(r#"{"rules": [], "extra": 1}"#));
        assert!(fails(r#"{"rules": [{"name": "a", "extra": 1}]}"#));
        assert!(fails(r#"{"rules": [{"name": "a", "naming": {"pattern": "x", "extra": 1}}]}"#));
        assert!(fails(r#"{"rules": [{"name": "a", "length": {"max": 3, "maxLenght": 4}}]}"#));
    }

    #[test]
    fn accepts_known_keys() {
        assert!(!fails(r#"{"rules": [{"name": "a", "length": {"max": 3}}]}"#));
    }
}

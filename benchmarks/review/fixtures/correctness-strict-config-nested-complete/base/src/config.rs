use serde::Deserialize;

#[derive(Debug, Default, Deserialize)]
pub struct Config {
    pub rules: Vec<RuleConfig>,
}

#[derive(Debug, Default, Deserialize)]
pub struct RuleConfig {
    pub name: String,
    pub naming: Option<NamingOptions>,
    pub length: Option<LengthOptions>,
}

#[derive(Debug, Default, Deserialize)]
pub struct NamingOptions {
    pub pattern: String,
}

#[derive(Debug, Default, Deserialize)]
pub struct LengthOptions {
    pub max: usize,
}

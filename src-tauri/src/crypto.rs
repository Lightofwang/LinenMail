use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use std::fs;
use std::path::Path;

const KEY_FILE_NAME: &str = ".linenmail.key";

pub struct LocalCipher {
    key: [u8; 32],
}

impl LocalCipher {
    pub fn load_or_create(data_dir: &Path) -> Result<Self, String> {
        let key_path = data_dir.join(KEY_FILE_NAME);
        if key_path.exists() {
            let encoded = fs::read_to_string(&key_path)
                .map_err(|e| format!("无法读取本地密钥文件: {}", e))?;
            let bytes = B64
                .decode(encoded.trim())
                .map_err(|e| format!("本地密钥格式无效: {}", e))?;
            if bytes.len() == 32 {
                let mut key = [0u8; 32];
                key.copy_from_slice(&bytes);
                return Ok(Self { key });
            }
        }

        let mut key = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut key);
        let encoded = B64.encode(key);
        fs::write(&key_path, encoded).map_err(|e| format!("无法创建本地密钥文件: {}", e))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&key_path, fs::Permissions::from_mode(0o600));
        }

        Ok(Self { key })
    }

    pub fn encrypt(&self, plaintext: &str) -> Result<String, String> {
        if plaintext.is_empty() {
            return Ok(String::new());
        }
        let cipher = Aes256Gcm::new_from_slice(&self.key)
            .map_err(|e| format!("加密引擎初始化失败: {}", e))?;
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|e| format!("凭证加密失败: {}", e))?;

        let mut combined = Vec::with_capacity(12 + ciphertext.len());
        combined.extend_from_slice(&nonce_bytes);
        combined.extend_from_slice(&ciphertext);
        Ok(format!("enc:v1:{}", B64.encode(combined)))
    }

    pub fn decrypt(&self, stored: &str) -> Result<String, String> {
        if stored.is_empty() {
            return Ok(String::new());
        }
        let payload = stored
            .strip_prefix("enc:v1:")
            .ok_or_else(|| "未知的密文版本".to_string())?;
        let combined = B64
            .decode(payload)
            .map_err(|e| format!("密文解码失败: {}", e))?;
        if combined.len() <= 12 {
            return Err("密文数据不完整".to_string());
        }
        let (nonce_bytes, ciphertext) = combined.split_at(12);
        let cipher = Aes256Gcm::new_from_slice(&self.key)
            .map_err(|e| format!("解密引擎初始化失败: {}", e))?;
        let plaintext = cipher
            .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
            .map_err(|e| format!("凭证解密失败: {}", e))?;
        String::from_utf8(plaintext).map_err(|e| format!("解密文本编码无效: {}", e))
    }
}

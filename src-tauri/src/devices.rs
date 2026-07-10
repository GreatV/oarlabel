use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct DeviceOption {
    pub key: &'static str,
    pub label: &'static str,
}

pub fn available_devices() -> Vec<DeviceOption> {
    #[cfg(all(feature = "cuda", not(target_os = "macos")))]
    {
        vec![
            DeviceOption {
                key: "cpu",
                label: "CPU",
            },
            DeviceOption {
                key: "cuda",
                label: "CUDA",
            },
        ]
    }

    #[cfg(not(all(feature = "cuda", not(target_os = "macos"))))]
    {
        vec![DeviceOption {
            key: "cpu",
            label: "CPU",
        }]
    }
}

/** 설정 조회 중에도 본문 원본을 가리고, 비활성화 설정은 즉시 반영한다. */
(() => {
    let current = { enabled: true, protectPending: true };
    const apply = settings => {
        current = { ...current, ...settings };
        settings = current;
        document.documentElement?.classList.toggle('kas-extension-enabled', settings?.enabled !== false);
        document.documentElement?.classList.toggle('kas-protect-pending', settings?.enabled !== false && settings?.protectPending !== false);
    };
    apply();
    chrome.runtime.sendMessage({ type: 'GET_PROTECTION_SETTINGS' }).then(value => { if (value && !value.error) apply(value); }).catch(() => {});
    chrome.runtime.onMessage.addListener((message, sender) => {
        if (sender.id !== chrome.runtime.id) return;
        if (message.type === 'SETTINGS_UPDATED') apply({ enabled: message.settings.enabled, protectPending: message.settings.protectPending });
        if (message.type === 'TOGGLE_EXTENSION') apply({ enabled: message.enabled });
    });
})();

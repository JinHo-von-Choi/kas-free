/**
 * 카-스 프리 팝업 스크립트
 * @author 최진호
 * @date 2026-01-31
 * @version 1.0.0
 */

(function() {
    'use strict';

    /** DOM 요소 */
    const elements = {
        toggleEnabled:  document.getElementById('toggleEnabled'),
        statsScanned:   document.getElementById('statsScanned'),
        statsSafe:      document.getElementById('statsSafe'),
        statsCaution:   document.getElementById('statsCaution'),
        statsDanger:    document.getElementById('statsDanger'),
        apiNsfwjs:      document.getElementById('apiNsfwjs'),
        apiGeminiFlash: document.getElementById('apiGeminiFlash'),
        apiClaudeHaiku: document.getElementById('apiClaudeHaiku'),
        apiGpt4oMini:   document.getElementById('apiGpt4oMini'),
        btnSettings:    document.getElementById('btnSettings'),
        popupVersion:   document.getElementById('popupVersion')
    };

    /**
     * 초기화
     */
    async function initialize() {
        loadVersion();
        await loadSettings();
        await loadStats();
        await checkApiStatus();
        bindEvents();
    }

    /**
     * 버전 정보를 로드한다
     */
    function loadVersion() {
        const manifest = chrome.runtime.getManifest();
        if (elements.popupVersion) {
            elements.popupVersion.textContent = `v${manifest.version}`;
        }
    }

    /**
     * 설정을 로드한다
     */
    async function loadSettings() {
        const settings = await sendMessage({ type: 'GET_SETTINGS' });

        if (settings) {
            elements.toggleEnabled.checked = settings.enabled !== false;
        }
    }

    /**
     * 통계를 로드한다
     */
    async function loadStats() {
        const stats = await sendMessage({ type: 'GET_STATS' });

        if (stats && stats.today) {
            elements.statsScanned.textContent = stats.today.scanned || 0;
            elements.statsSafe.textContent    = stats.today.safe || 0;
            elements.statsCaution.textContent = stats.today.caution || 0;
            elements.statsDanger.textContent  = stats.today.danger || 0;
        }
    }

    /**
     * API 상태를 확인한다
     */
    async function checkApiStatus() {
        const status = await sendMessage({ type: 'CHECK_API_STATUS' });

        if (status) {
            updateApiIndicator(elements.apiNsfwjs, status.nsfwjs);
            updateApiIndicator(elements.apiGeminiFlash, status.geminiFlash, true);
            updateApiIndicator(elements.apiClaudeHaiku, status.claudeHaiku, true);
            updateApiIndicator(elements.apiGpt4oMini, status.gpt4oMini, true);
        }
    }

    /**
     * API 인디케이터를 업데이트한다
     * @param {HTMLElement} element - 인디케이터 엘리먼트
     * @param {boolean} isConnected - 연결 상태
     * @param {boolean} isOptional - 선택적 API 여부
     */
    function updateApiIndicator(element, isConnected, isOptional = false) {
        if (isConnected) {
            element.dataset.status = 'connected';
        } else if (isOptional) {
            element.dataset.status = 'unconfigured';
        } else {
            element.dataset.status = 'error';
        }
    }

    /**
     * 이벤트를 바인딩한다
     */
    function bindEvents() {
        /** 토글 스위치 */
        elements.toggleEnabled.addEventListener('change', async (e) => {
            const enabled = e.target.checked;
            await sendMessage({
                type:    'TOGGLE_EXTENSION',
                enabled: enabled
            });
        });

        /** 설정 버튼 */
        elements.btnSettings.addEventListener('click', () => {
            chrome.runtime.openOptionsPage();
        });
    }

    /**
     * 백그라운드에 메시지를 전송한다
     * @param {object} message - 메시지 객체
     * @returns {Promise<any>}
     */
    function sendMessage(message) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('[Kas-Free] Message error:', chrome.runtime.lastError);
                    resolve(null);
                    return;
                }
                resolve(response);
            });
        });
    }

    /** 초기화 실행 */
    document.addEventListener('DOMContentLoaded', initialize);
})();

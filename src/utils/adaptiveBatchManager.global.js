/**
 * Adaptive Batch Manager (동적 배치 크기 조절) - Global Script Version
 * @author 최진호
 * @date 2026-02-26
 * @version 1.0.0
 */

(function(window) {
    'use strict';

    class AdaptiveBatchManager {
        constructor(options = {}) {
            this.minBatchSize = options.minBatchSize || 5;
            this.maxBatchSize = options.maxBatchSize || 100;
            this.defaultBatchSize = options.defaultBatchSize || 30;
            this.currentBatchSize = this.defaultBatchSize;
            this.networkInfo = null;
            this.stats = {
                totalBatches: 0,
                successfulBatches: 0,
                failedBatches: 0,
                consecutiveSuccesses: 0,
                consecutiveFailures: 0,
                adjustmentCount: 0,
                totalItemsProcessed: 0
            };
            this.isMemoryPressure = false;
            this.connection = null;

            this.init();
        }

        init() {
            if ('connection' in navigator || 'mozConnection' in navigator || 'webkitConnection' in navigator) {
                this.connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
                this.connection.addEventListener('change', () => {
                    this.updateNetworkInfo();
                    this.adjustBatchSize();
                });
                this.updateNetworkInfo();
            }

            if ('memory' in performance) {
                setInterval(() => this.checkMemoryPressure(), 5000);
            }

            console.log('[AdaptiveBatchManager] 초기화 완료');
        }

        updateNetworkInfo() {
            if (!this.connection) return;

            this.networkInfo = {
                effectiveType: this.connection.effectiveType,
                downlink: this.connection.downlink,
                rtt: this.connection.rtt,
                saveData: this.connection.saveData
            };

            console.log('[AdaptiveBatchManager] 네트워크 상태:', this.networkInfo);
        }

        calculateBatchSize() {
            let batchSize = this.defaultBatchSize;

            if (this.networkInfo) {
                const { effectiveType, downlink, saveData } = this.networkInfo;

                if (saveData) {
                    batchSize = this.minBatchSize;
                } else if (effectiveType === '4g' && downlink >= 5) {
                    batchSize = 50;
                } else if (effectiveType === '3g' || (downlink >= 2 && downlink < 5)) {
                    batchSize = 30;
                } else if (effectiveType === '2g' || effectiveType === 'slow-2g' || downlink < 2) {
                    batchSize = 10;
                }
            }

            if (this.isMemoryPressure) {
                batchSize = Math.max(this.minBatchSize, Math.floor(batchSize * 0.5));
            }

            return Math.max(this.minBatchSize, Math.min(this.maxBatchSize, batchSize));
        }

        adjustBatchSize() {
            const oldBatchSize = this.currentBatchSize;
            this.currentBatchSize = this.calculateBatchSize();

            if (oldBatchSize !== this.currentBatchSize) {
                this.stats.adjustmentCount++;
                console.log(`[AdaptiveBatchManager] 배치 크기 조절: ${oldBatchSize} → ${this.currentBatchSize}`);
            }
        }

        getBatchSize() {
            return this.currentBatchSize;
        }

        recordSuccess(itemCount) {
            this.stats.totalBatches++;
            this.stats.successfulBatches++;
            this.stats.consecutiveSuccesses++;
            this.stats.consecutiveFailures = 0;
            this.stats.totalItemsProcessed += itemCount;

            if (this.stats.consecutiveSuccesses >= 3 && this.currentBatchSize < this.maxBatchSize) {
                const newBatchSize = Math.min(this.maxBatchSize, Math.floor(this.currentBatchSize * 1.1));
                if (newBatchSize !== this.currentBatchSize) {
                    console.log(`[AdaptiveBatchManager] 연속 성공: 배치 크기 증가 ${this.currentBatchSize} → ${newBatchSize}`);
                    this.currentBatchSize = newBatchSize;
                    this.stats.adjustmentCount++;
                    this.stats.consecutiveSuccesses = 0;
                }
            }
        }

        recordFailure(error) {
            this.stats.totalBatches++;
            this.stats.failedBatches++;
            this.stats.consecutiveFailures++;
            this.stats.consecutiveSuccesses = 0;

            if (this.stats.consecutiveFailures >= 2 && this.currentBatchSize > this.minBatchSize) {
                const newBatchSize = Math.max(this.minBatchSize, Math.floor(this.currentBatchSize * 0.5));
                console.warn(`[AdaptiveBatchManager] 연속 실패: 배치 크기 감소 ${this.currentBatchSize} → ${newBatchSize}`);
                this.currentBatchSize = newBatchSize;
                this.stats.adjustmentCount++;
                this.stats.consecutiveFailures = 0;
            }
        }

        checkMemoryPressure() {
            if (!('memory' in performance)) return;

            const memory = performance.memory;
            const usageRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
            const wasMemoryPressure = this.isMemoryPressure;
            this.isMemoryPressure = usageRatio > 0.9;

            if (this.isMemoryPressure && !wasMemoryPressure) {
                console.warn('[AdaptiveBatchManager] 메모리 압박 감지');
                this.adjustBatchSize();
            } else if (!this.isMemoryPressure && wasMemoryPressure) {
                console.log('[AdaptiveBatchManager] 메모리 압박 해소');
                this.adjustBatchSize();
            }
        }

        splitIntoBatches(items) {
            const batchSize = this.getBatchSize();
            const batches = [];

            for (let i = 0; i < items.length; i += batchSize) {
                batches.push(items.slice(i, i + batchSize));
            }

            console.log(`[AdaptiveBatchManager] ${items.length}개 → ${batches.length}개 배치 (배치당 ${batchSize}개)`);
            return batches;
        }

        getStats() {
            return {
                ...this.stats,
                currentBatchSize: this.currentBatchSize,
                networkInfo: this.networkInfo,
                isMemoryPressure: this.isMemoryPressure,
                successRate: this.stats.totalBatches > 0
                    ? ((this.stats.successfulBatches / this.stats.totalBatches) * 100).toFixed(2) + '%'
                    : '0%'
            };
        }

        destroy() {
            this.stats = {
                totalBatches: 0,
                successfulBatches: 0,
                failedBatches: 0,
                consecutiveSuccesses: 0,
                consecutiveFailures: 0,
                adjustmentCount: 0,
                totalItemsProcessed: 0
            };
        }
    }

    let instance = null;

    function getAdaptiveBatchManager() {
        if (!instance) {
            instance = new AdaptiveBatchManager();
        }
        return instance;
    }

    window.AdaptiveBatchManager = AdaptiveBatchManager;
    window.getAdaptiveBatchManager = getAdaptiveBatchManager;

})(window);

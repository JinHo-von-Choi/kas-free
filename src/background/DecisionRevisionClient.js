/** 판정 캐시의 유효성을 확인하는 공개 서버 메타데이터 조회. */
export class DecisionRevisionClient {
    constructor({ baseUrl = 'https://nsfw.nerdvana.kr', fetchFn = (...args) => fetch(...args), now = () => Date.now(), ttl = 10000 } = {}) {
        this.baseUrl = baseUrl;
        this.fetchFn = fetchFn;
        this.now = now;
        this.ttl = ttl;
        this.nextRefresh = 0;
        this.revision = null;
        this.pending = null;
    }

    getRevision() {
        if (this.pending) return this.pending;
        if (this.now() < this.nextRefresh) return Promise.resolve(this.revision);
        this.pending = this.fetchRevision().finally(() => { this.pending = null; });
        return this.pending;
    }

    async fetchRevision() {
        try {
            const response = await this.fetchFn(this.baseUrl + '/api/policy/revision', {
                credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(3000)
            });
            if (!response.ok) throw new Error('Revision unavailable');
            const body = await response.json();
            const revision = body.data?.decisionRevision;
            if (!body.success || typeof revision !== 'string' || !revision || revision.length > 512) throw new Error('Invalid revision');
            this.revision = revision;
        } catch { this.revision = null; }
        this.nextRefresh = this.now() + this.ttl;
        return this.revision;
    }
}

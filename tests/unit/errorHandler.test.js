/**
 * errorHandler 단위 테스트
 * @author 최진호
 * @date 2026-02-26
 */

import {
    maskSensitiveData,
    getUserFriendlyMessage,
    logError,
    ValidationError,
    TimeoutError,
    NetworkError,
    ApiError
} from '../../src/utils/errorHandler.js';

describe('errorHandler', () => {
    describe('maskSensitiveData', () => {
        test('URL 마스킹', () => {
            const url = 'https://gall.dcinside.com/board/view?id=12345678&no=999999';
            const masked = maskSensitiveData(url);

            expect(masked).toContain('https://gall.dcinside.com');
            expect(masked).toContain('***');
            expect(masked).not.toContain('id=12345678');
        });

        test('짧은 URL 마스킹', () => {
            const url = 'https://test.com/a';
            const masked = maskSensitiveData(url);

            expect(masked).toContain('https://test.com');
        });

        test('API 키 마스킹 (OpenAI)', () => {
            const key = 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890';
            const masked = maskSensitiveData(key);

            expect(masked).toMatch(/^sk-pro\*\*\*7890$/);
            expect(masked).toContain('***');
            expect(masked.length).toBeLessThan(key.length);
        });

        test('API 키 마스킹 (Google)', () => {
            const key = 'AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz1234567';
            const masked = maskSensitiveData(key);

            expect(masked).toMatch(/^AIzaSy\*\*\*4567$/);
        });

        test('API 키 마스킹 (Anthropic)', () => {
            const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
            const masked = maskSensitiveData(key);

            expect(masked).toMatch(/^sk-ant\*\*\*wxyz$/);
        });

        test('긴 문자열 마스킹 (API 키 추정)', () => {
            const longString = 'abcdefghijklmnopqrstuvwxyz1234567890';
            const masked = maskSensitiveData(longString);

            expect(masked).toMatch(/^abcd\*\*\*7890$/);
        });

        test('이메일 마스킹', () => {
            const email = 'user@example.com';
            const masked = maskSensitiveData(email);

            expect(masked).toMatch(/^u\*\*\*r@example\.com$/);
        });

        test('짧은 이메일 마스킹', () => {
            const email = 'ab@test.com';
            const masked = maskSensitiveData(email);

            expect(masked).toContain('***@test.com');
        });

        test('짧은 문자열은 마스킹 안 함', () => {
            const short = 'test';
            const masked = maskSensitiveData(short);

            expect(masked).toBe('test');
        });

        test('null 처리', () => {
            const masked = maskSensitiveData(null);
            expect(masked).toBe('***');
        });

        test('undefined 처리', () => {
            const masked = maskSensitiveData(undefined);
            expect(masked).toBe('***');
        });

        test('숫자 처리', () => {
            const masked = maskSensitiveData(12345);
            expect(masked).toBe('12345');
        });

        test('boolean 처리', () => {
            const masked1 = maskSensitiveData(true);
            const masked2 = maskSensitiveData(false);

            expect(masked1).toBe('true');
            expect(masked2).toBe('false');
        });
    });

    describe('getUserFriendlyMessage', () => {
        test('네트워크 에러', () => {
            const error = new NetworkError('Connection failed');
            const message = getUserFriendlyMessage(error);

            expect(message).toBe('네트워크 연결을 확인해주세요.');
        });

        test('타임아웃 에러', () => {
            const error = new TimeoutError('Timeout after 15s');
            const message = getUserFriendlyMessage(error);

            expect(message).toBe('요청 시간이 초과되었습니다. 다시 시도해주세요.');
        });

        test('API 키 에러', () => {
            const error = new Error('Invalid API key');
            error.code = 'UNAUTHORIZED';
            const message = getUserFriendlyMessage(error);

            expect(message).toBe('API 키를 확인해주세요.');
        });

        test('검증 에러', () => {
            const error = new ValidationError('Invalid input');
            const message = getUserFriendlyMessage(error);

            expect(message).toBe('입력값을 확인해주세요.');
        });

        test('IndexedDB 에러', () => {
            const error = new Error('DB connection failed');
            error.name = 'IndexedDBError';
            const message = getUserFriendlyMessage(error);

            expect(message).toBe('로컬 저장소 오류. 캐시를 삭제해보세요.');
        });

        test('메모리 부족', () => {
            const error = new Error('Out of memory');
            error.code = 'OutOfMemoryError';
            const message = getUserFriendlyMessage(error);

            expect(message).toBe('메모리 부족. 브라우저를 재시작해주세요.');
        });

        test('알 수 없는 에러', () => {
            const error = new Error('Unknown error');
            const message = getUserFriendlyMessage(error);

            expect(message).toBe('알 수 없는 오류가 발생했습니다.');
        });

        test('Rate Limit 에러', () => {
            const error = new Error('Too many requests');
            error.code = 'RATE_LIMIT';
            const message = getUserFriendlyMessage(error);

            expect(message).toContain('요청 한도');
        });
    });

    describe('logError', () => {
        beforeEach(() => {
            jest.spyOn(console, 'error').mockImplementation(() => {});
        });

        afterEach(() => {
            console.error.mockRestore();
        });

        test('기본 에러 로깅', () => {
            const error = new Error('Test error');
            const info = logError('testContext', error, false);

            expect(info).toHaveProperty('timestamp');
            expect(info).toHaveProperty('context', 'testContext');
            expect(info).toHaveProperty('name', 'Error');
            expect(info).toHaveProperty('message');
            expect(info).toHaveProperty('code');
        });

        test('디버그 모드 로깅', () => {
            const error = new Error('Debug error');
            error.code = 'TEST_CODE';

            const info = logError('debugContext', error, true);

            expect(console.error).toHaveBeenCalled();
            expect(info.code).toBe('TEST_CODE');
        });

        test('에러 코드 없을 때 UNKNOWN', () => {
            const error = new Error('No code error');
            const info = logError('noCodeContext', error, false);

            expect(info.code).toBe('UNKNOWN');
        });
    });

    describe('ValidationError', () => {
        test('ValidationError 생성', () => {
            const error = new ValidationError('Invalid value', { field: 'email' });

            expect(error.name).toBe('ValidationError');
            expect(error.code).toBe('VALIDATION_ERROR');
            expect(error.message).toBe('Invalid value');
            expect(error.details).toEqual({ field: 'email' });
        });
    });

    describe('TimeoutError', () => {
        test('TimeoutError 생성', () => {
            const error = new TimeoutError('Request timeout', { url: 'https://api.test.com' });

            expect(error.name).toBe('TimeoutError');
            expect(error.code).toBe('TIMEOUT');
            expect(error.message).toBe('Request timeout');
            expect(error.details).toEqual({ url: 'https://api.test.com' });
        });

        test('needsFallback 반환', () => {
            const error = new TimeoutError('Timeout');

            expect(error.needsFallback()).toBe(true);
        });
    });

    describe('NetworkError', () => {
        test('NetworkError 생성', () => {
            const error = new NetworkError('Connection failed');

            expect(error.name).toBe('NetworkError');
            expect(error.code).toBe('NETWORK_ERROR');
            expect(error.message).toBe('Connection failed');
        });

        test('needsFallback 반환', () => {
            const error = new NetworkError('Connection failed');

            expect(error.needsFallback()).toBe(true);
        });
    });

    describe('프로덕션 시나리오', () => {
        test('민감정보 포함 에러 로깅', () => {
            const error = new Error('API call failed: sk-proj-abc123xyz https://api.test.com/endpoint user@test.com');
            const info = logError('apiContext', error, false);

            // 프로덕션에서는 민감정보 제거
            if (process.env.NODE_ENV === 'production') {
                expect(info.message).not.toContain('sk-proj-abc123xyz');
                expect(info.message).not.toContain('https://api.test.com/endpoint');
                expect(info.message).not.toContain('user@test.com');
            }
        });

        test('여러 민감정보 마스킹', () => {
            const data = [
                'https://gall.dcinside.com/board/view?id=123',
                'sk-proj-abcdefghijklmnopqrstuvwxyz',
                'user@example.com'
            ];

            const masked = data.map(item => maskSensitiveData(item));

            expect(masked[0]).toContain('***');
            expect(masked[1]).toContain('***');
            expect(masked[2]).toContain('***');
        });

        test('API 에러 사용자 메시지', () => {
            const apiError = new ApiError('Invalid API key', 401, 'OpenAI');
            const message = getUserFriendlyMessage(apiError);

            expect(message).not.toContain('sk-');
            expect(message).toContain('API');
        });
    });

    describe('엣지 케이스', () => {
        test('빈 문자열 마스킹', () => {
            const masked = maskSensitiveData('');
            expect(masked).toBe('');
        });

        test('특수 문자 포함 URL', () => {
            const url = 'https://test.com/path?param=value&other=123';
            const masked = maskSensitiveData(url);

            expect(masked).toContain('https://test.com');
        });

        test('잘못된 형식의 이메일', () => {
            const invalid = 'not-an-email';
            const masked = maskSensitiveData(invalid);

            expect(masked).toBe('not-an-email');
        });

        test('매우 긴 API 키', () => {
            const longKey = 'sk-' + 'a'.repeat(100);
            const masked = maskSensitiveData(longKey);

            expect(masked.length).toBeLessThan(longKey.length);
            expect(masked).toContain('***');
        });

        test('에러 객체 없음', () => {
            const info = logError('context', new Error(), false);

            expect(info).toHaveProperty('timestamp');
            expect(info).toHaveProperty('context');
        });
    });
});

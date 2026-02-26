# Kas-Free 테스트 가이드

작성자: 최진호
작성일: 2026-02-12

## 개요

Kas-Free Chrome 확장 프로그램의 단위 테스트 및 E2E 테스트를 수행하는 방법을 설명합니다.

## 테스트 환경 설정

### 1. 의존성 설치

```bash
npm install
```

### 2. 설치되는 패키지

- `jest`: JavaScript 테스트 프레임워크
- `jest-chrome`: Chrome Extension API Mock
- `jest-environment-jsdom`: DOM 환경 시뮬레이션
- `puppeteer`: Chrome 자동화 및 E2E 테스트

## 테스트 실행

### 단위 테스트

모든 단위 테스트를 실행합니다:

```bash
npm test
```

Watch 모드로 실행 (파일 변경 시 자동 재실행):

```bash
npm run test:watch
```

커버리지 리포트 생성:

```bash
npm run test:coverage
```

### E2E 테스트

Puppeteer를 사용한 E2E 테스트 실행:

```bash
npm run test:e2e
```

### 전체 테스트

단위 테스트 + E2E 테스트를 모두 실행:

```bash
npm run test:all
```

## 테스트 구조

### 단위 테스트 (`tests/unit/`)

- `CacheManager.test.js`: 캐시 관리 로직 테스트
- `PerformanceMonitor.test.js`: 성능 모니터링 로직 테스트
- `HashChecker.test.js`: 해시 기반 이미지 검사 로직 테스트

### E2E 테스트 (`tests/e2e/`)

- `extension.test.js`: 확장 프로그램 로드, 팝업, 옵션 페이지 테스트
- `performance.test.js`: 성능 메트릭 측정 테스트

## 커버리지 목표

- **Branches**: 70%
- **Functions**: 70%
- **Lines**: 70%
- **Statements**: 70%

## 테스트 작성 가이드

### 단위 테스트 작성 규칙

1. **파일명**: `<ModuleName>.test.js`
2. **위치**: `tests/unit/`
3. **구조**:
   ```javascript
   describe('모듈명', () => {
       describe('메서드명', () => {
           test('테스트 설명', async () => {
               // Given
               // When
               // Then
           });
       });
   });
   ```

### E2E 테스트 작성 규칙

1. **파일명**: `<feature>.test.js`
2. **위치**: `tests/e2e/`
3. **타임아웃**: 30초 (복잡한 작업의 경우)
4. **브라우저 설정**:
   ```javascript
   browser = await puppeteer.launch({
       headless: false,
       args: [
           `--disable-extensions-except=${EXTENSION_PATH}`,
           `--load-extension=${EXTENSION_PATH}`
       ]
   });
   ```

## 성능 메트릭 테스트

성능 모니터링 기능은 다음을 측정합니다:

### 1. 분석 시간 트래킹

- 총 분석 횟수
- 평균 분석 시간
- 최소/최대 분석 시간

### 2. 캐시 히트율

- 캐시 히트 횟수
- 캐시 미스 횟수
- 히트율 (%)

### 3. API 호출 통계

- 총 API 호출 횟수
- 평균 API 응답 시간
- 에러 발생 횟수
- 에러율 (%)

### 4. 해시 생성 시간

- 총 해시 생성 횟수
- 평균 해시 생성 시간

### 5. 세션 정보

- 세션 시작 시간
- 세션 지속 시간
- 마지막 리셋 시간

## 문제 해결

### Chrome Extension API Mock 에러

`chrome is not defined` 에러가 발생하면 `tests/setup.js`가 제대로 로드되었는지 확인하세요.

### Puppeteer 브라우저 실행 실패

Windows에서 `chromium` 실행 실패 시:

```bash
node node_modules/puppeteer/install.js
```

### 타임아웃 에러

E2E 테스트에서 타임아웃이 발생하면 `jest.e2e.config.js`의 `testTimeout` 값을 늘리세요.

## CI/CD 통합

GitHub Actions 예시:

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
      - run: npm run test:coverage
```

## 참고 자료

- [Jest 공식 문서](https://jestjs.io/)
- [Puppeteer 공식 문서](https://pptr.dev/)
- [Chrome Extension Testing 가이드](https://developer.chrome.com/docs/extensions/mv3/tut_testing/)

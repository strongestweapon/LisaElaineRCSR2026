# GPX Project - Rolex China Sea Race 2026

## YB Tracking API - GPS 데이터 가져오는 방법

### 엔드포인트
- **Race Setup (JSON):** `https://yb.tl/JSON/{raceKey}/RaceSetup`
  - 팀 목록, 디비전(태그), 코스, 설정 등 전체 레이스 정보
  - 팀 객체에 `tags` 배열로 디비전 매핑 (예: 79547 = IRC Premier)
  - `course.nodes` = 럼 라인 웨이포인트, `course.distance` = 코스 거리 (km 단위)
  - `poi.lines` = Start, Finish Line, Exclusion Zone 등
- **위치 데이터 (Binary):** `https://yb.tl/BIN/{raceKey}/AllPositions3`
  - 모든 팀의 전체 트랙 데이터를 바이너리 포맷으로 반환
  - `yb_parser.js`의 `parseAllPositions3()`로 디코딩
- **리더보드 (JSON):** `https://yb.tl/JSON/{raceKey}/leaderboard`
  - 순위, 완주 시간, 핸디캡 결과
  - 주요 필드: elapsed, cElapsed(corrected), dtf, tcf, dmg(distance made good, 미터), eElapsedR(projected total elapsed)
- **JSON 위치 데이터 (백업):** `https://yb.tl/JSON/{raceKey}/AllPositionsPlus`
  - BIN 실패 시 폴백용 (현재 500 에러)

### 사용법
```bash
# IRC Premier 4척 (기본값)
node fetch_yb_tracks.js

# 특정 레이스, 특정 팀
node fetch_yb_tracks.js rolexchinasea2026 1,2,3

# 전체 팀 ID는 RaceSetup에서 확인
```

### IRC Premier (tag 79547) 팀
| ID | Name | Model | TcF |
|----|------|-------|-----|
| 6 | Fenice | 60 | 1.206 |
| 10 | Moonblue 2 | 64 | 1.195 |
| 14 | Parnassus | 56 | 1.220 |
| 21 | Lisa Elaine | Cruiser 56 | 1.069 |

### IRC Corrected Time 계산

**피니시 시:**
```
Corrected Time = Elapsed Time × TcF
```
- 검증: Fenice 221321초 × 1.206 = 266913초 (YB 리더보드 cElapsed 일치)
- 낮은 corrected time = 높은 순위
- 높은 TcF = 빠른 배 (더 큰 페널티)

**레이스 중 (Projected Corrected Time):**
```
Projected Corrected Time = (elapsed + DTF / avgSpeed) × TcF
```
- elapsed = 스타트 이후 경과 시간 (초)
- DTF = 현재 위치에서 피니시까지 럼 라인 기준 거리 (nm)
- avgSpeed = 지금까지 이동거리 / 경과시간 (knots) — VMG(바람 방향 대비 최적속도)가 아님
- TcF = IRC Time Correction Factor (RaceSetup team.tcf2)
- 라이브러리: `yb_parser.js`의 `projectedCorrectedTime(elapsed, distSailed, dtf, tcf)`

### 바이너리 포맷 (AllPositions3)
파서: `yb_parser.js` - pro.yb.tl 뷰어 JS 번들에서 역공학한 디코더.

**구조:**
- Header 5바이트: flags(1) + baseTimestamp(4)
- 팀별: teamId(2) + numPositions(2) + positions[...]
- 포지션: 첫 바이트 bit7로 절대/델타 구분
- 좌표는 정수로 인코딩, 최종적으로 1e5로 나눠서 소수점 좌표로 변환

### 코스 데이터
- 럼 라인: `course.nodes` (19개 웨이포인트, Start → Finish)
- Tathong Channel Exclusion Zone: `poi.lines` (노란 폴리곤)
- Finish Line: `poi.lines` (빨간선, 3포인트)
- `course.distance`는 km 단위 (1066km ≈ 576nm)

### 파일 구조
- `yb_parser.js` - YB Tracking 바이너리 파서 + IRC corrected time 계산 라이브러리
- `fetch_yb_tracks.js` - GPX 파일 생성 스크립트
- `rcsr2026_course.gpx` - 럼 라인, Start, Finish Line, Exclusion Zone
- `RCSR2026.gpx` - Lisa Elaine 최종 병합 트랙 (Strava + YB + gap fill)
- `{boat}_yb.gpx` - 각 보트별 YB 트랙 데이터
- `index.html` - 지도 뷰어 (Lisa Elaine + IRC Premier 경쟁 보트들)

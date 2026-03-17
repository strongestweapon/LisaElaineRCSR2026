# GPX Project - Rolex China Sea Race 2026

## YB Tracking API - GPS 데이터 가져오는 방법

### 핵심 요약
- **Position 데이터는 바이너리(BIN)로만 제공됨** — JSON 엔드포인트는 전부 500 에러
- 진행 중인 레이스도, 끝난 레이스도 동일하게 BIN만 동작 (2026-03-17 확인)
- 바이너리 파서는 pro.yb.tl 뷰어의 JS 번들(`/assets/index-*.js`)에서 역공학함

### 엔드포인트
- **Race Setup (JSON):** `https://yb.tl/JSON/{raceKey}/RaceSetup`
  - 팀 목록, 디비전(태그), 코스, 설정 등 전체 레이스 정보
  - 팀 객체에 `tags` 배열로 디비전 매핑 (예: 79547 = IRC Premier)
  - 팀별 `tcf2` = IRC Time Correction Factor
  - `course.nodes` = 럼 라인 웨이포인트, `course.distance` = 코스 거리 (**km 단위**, nm 아님!)
  - `poi.lines` = Start, Finish Line, Exclusion Zone 등
  - `teams[].finishedAt` = 피니시 unix timestamp
- **위치 데이터 (Binary):** `https://yb.tl/BIN/{raceKey}/AllPositions3`
  - 모든 팀의 전체 트랙 데이터를 바이너리 포맷으로 반환
  - `yb_parser.js`의 `parseAllPositions3()`로 디코딩
  - 결과: `[{ id: teamId, moments: [{ lat, lon, at(unix timestamp), dtf?, alt? }, ...] }]`
  - moments는 시간 역순(최신→과거)으로 나옴 → GPX 출력 시 정렬 필요
- **리더보드 (JSON):** `https://yb.tl/JSON/{raceKey}/leaderboard`
  - 순위, 완주 시간, 핸디캡 결과
  - 주요 필드: elapsed, cElapsed(corrected), dtf(미터), tcf, dmg(distance made good, 미터)
  - 진행 중: eElapsedR(projected total elapsed), eFinishR(=start+eElapsedR), vmgR, vmgS
- **JSON 위치 데이터:** `https://yb.tl/JSON/{raceKey}/AllPositionsPlus`
  - BIN 실패 시 폴백용이지만, 현재까지 확인한 모든 레이스에서 500 에러

### 역공학 방법 (바이너리 파서)
1. `curl -s "https://pro.yb.tl/{raceKey}/" | grep -oE 'src="[^"]*\.js[^"]*"'` → JS 번들 URL
2. 번들에서 `AllPositions3` 검색 → `BIN/${raceKey}/AllPositions3` 엔드포인트 확인
3. 번들에서 `lat/=1e5` 검색 → 바이너리 파서 함수(o9) 발견
4. minified 코드를 정리해서 `yb_parser.js`로 포팅

### 사용법
```bash
# IRC Premier 4척 (기본값)
node fetch_yb_tracks.js

# 특정 레이스, 특정 팀
node fetch_yb_tracks.js rolexchinasea2026 1,2,3

# 전체 팀 ID는 RaceSetup에서 확인
```

### IRC Premier (tag 79547) 팀 — RCSR 2026
| ID | Name | Model | TcF | Elapsed | Corrected | Rank |
|----|------|-------|-----|---------|-----------|------|
| 6 | Fenice | 60 | 1.206 | 2d 13h 28m | 3d 2h 8m | 1 |
| 10 | Moonblue 2 | 64 | 1.195 | 2d 16h 16m | 3d 4h 48m | 2 |
| 14 | Parnassus | 56 | 1.220 | 2d 16h 34m | 3d 6h 47m | 3 |
| 21 | Lisa Elaine | Cruiser 56 | 1.069 | 3d 2h 21m | 3d 7h 28m | 4 |

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
  - bit 0: has altitude, bit 1: has dtf, bit 2: has laps, bit 3: has pc
  - bit 0+2+3 모두 set → "super" mode (bigUint64 for count)
- 팀별: teamId(2) + numPositions(2 or 8) + positions[...]
- 포지션: 첫 바이트 bit7(& 128)로 절대/델타 구분
  - 절대: timeOffset(4) + lat(int32) + lon(int32) + optional fields
  - 델타: timeDelta+flags(uint16) + dlat(int16) + dlon(int16) + optional fields
- 좌표는 정수로 인코딩, 최종적으로 1e5로 나눠서 소수점 좌표로 변환
- 시간: 절대=base+offset, 델타=prev.at-timeDelta (역순!)

### 코스 데이터
- 럼 라인: `course.nodes` (19개 웨이포인트, Start → Finish)
- Tathong Channel Exclusion Zone: `poi.lines` (노란 폴리곤)
- Finish Line: `poi.lines` (빨간선, 3포인트)
- Start: `poi.lines` (녹색 포인트)
- `course.distance`는 **km 단위** (1066km ≈ 576nm, 공식 거리 565nm은 반올림)

### 레이스 분석 요약
- Lisa Elaine은 **루트는 좋았음** (580.8nm, 4척 중 최단)
- 문제는 **속도** (7.81kn avg vs Fenice 9.48kn)와 **수빅 wind hole**
- 수빅 어프로치(DTF 35nm, elapsed 64h+)에서 TWS 25→3kn 폭락, 10시간 표류
- 다른 배들(Moonblue2, Parnassus)은 럼라인 **서쪽 0.5-0.7도**로 항해 → wind shadow 회피
- 초반 TWA 100-115° (beam reach) → 내려서 130-140° (broad reach)로 갔으면 더 빨랐을 가능성
- A2 제네커 전개 추정: HKT 3/6 05:14 (TWS 15kn 이하 진입, lat 17.69)
- 풍향 데이터: `/Users/hojunsong/Documents/Github/NMEA2000Simulator/data/output/simulated_wind.csv`

### 파일 구조
- `yb_parser.js` - YB Tracking 바이너리 파서 + IRC corrected time 계산 라이브러리
  - `parseAllPositions3(buf)` - BIN 디코더
  - `toGPX(name, moments)` - GPX 변환
  - `haversineNm(lat1, lon1, lat2, lon2)` - 거리 계산
  - `distanceToFinish(lat, lon, rhumbLine)` - DTF 계산
  - `projectedCorrectedTime(elapsed, distSailed, dtf, tcf)` - IRC PCT 계산
- `fetch_yb_tracks.js` - GPX 파일 생성 스크립트 (CLI)
- `rcsr2026_course.gpx` - 럼 라인, Start, Finish Line, Exclusion Zone
- `RCSR2026.gpx` - Lisa Elaine 최종 병합 트랙 (Strava + YB + gap fill)
- `{boat}_yb.gpx` - 각 보트별 YB 트랙 데이터
- `index.html` - 지도 뷰어
  - Lisa Elaine 트랙 + 타임라인 재생 + 속도/거리 정보
  - IRC Premier 경쟁 보트 3척 트랙 + 마커
  - 럼 라인(흰색 점선), 스타트(녹색), 피니시(빨간선), 익스클루전 존(노란 폴리곤)
  - IRC Premier 리더보드 (projected corrected time, 실시간 순위)
  - Leaflet 기반, CARTO 타일
- `gpxbackup/` - 원본 GPX 파일들 (Strava, YB 개별, gap fill, merged)

### GitHub Pages
- Repo: `https://github.com/strongestweapon/LisaElaineRCSR2026`
- 로컬 서버: `python3 -m http.server 8080` (GPX fetch에 HTTP 서버 필요)

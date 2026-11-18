# 回饋

本檔記任務中發現之自有套件、全域技能、全域設定之調整與抽提提案;只增不改,處置結果另記一列.回饋為紀錄與提案,不等於自行修改.

| 日期 | 類別 | 對象 | 內容 | 依據 |
|---|---|---|---|---|
| 2026-11-09 | 全域設定 | §8 Shell 工具與環境 | 建議增補一條:Git Bash 下 `tar -xzf` 之路徑含磁碟機代號(如 `D:/...`)時,`tar` 把 `D:` 當遠端主機而失敗(`Cannot connect to ... resolve failed`),須加 `--force-local`;解壓舊版套件到 `./tmp/` 做升版比對時常用 | 2026-11-09 解壓 `npm pack` 產物之 `tar` 指令輸出 |
| 2026-11-18 | 自有套件 | w-trade-backtest `buildBaseUnitNotional` | 回傳只有 `key`、`getNotional`,不回轉換後之 `rule`、`buffer`、`units`;呼叫端判定通過後須自行再以 `cdbl` 轉一次(K4 之「判定通過即轉型、其後用轉換值」被拆成兩處).建議另回 `{ rule, buffer, units }`(轉換值),或公開與之同名之解析函數 | `src/calcContractUnitsQuantity.mjs` 之 `checkContractRuleBuffer`(判定後另轉);回測 1.1.40 `src/buildBaseUnitNotional.mjs:57-60` |
| 2026-11-18 | 自有套件 | w-trade-backtest `buildBaseUnitNotional` | 訊息之名稱以單一 `name` 涵蓋 `unit.rule` 與 `unit.buffer`(`<name>.rule.<欄>`、`<name>.buffer`、`<name>: step count k …`);規則與緩衝來自不同物件(規則由設定物件轉成、緩衝在 opt)時無法各給正確之參數名.建議可分別指定規則與緩衝之名稱(例:第 3 參數 `{ ruleName, bufferName }`);另其可計算性為「以價格 1 試算」,建議於 JSDoc 寫明「價格 1 不可計算即拒(與實際價格無關)」 | 回測 1.1.40 `src/buildBaseUnitNotional.mjs:32-41`;本庫 `test/api-binaFakeMarketUnits.test.mjs` 之 `st.digContractQuantity 20` 案(訊息名稱為 `opt`) |

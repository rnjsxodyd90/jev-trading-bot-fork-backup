"use client";

import DecisionPanel from "@/components/DecisionPanel/DecisionPanel";
import Feed from "@/components/Feed/Feed";
import FlowChart from "@/components/FlowChart/FlowChart";
import Header from "@/components/Header/Header";
import StatsRow from "@/components/StatsRow/StatsRow";
import { useFeed } from "@/lib/useFeed";
import styles from "./page.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export default function Page() {
  const feed = useFeed(API_URL);

  return (
    <div className="card">
      <Header meta={feed.meta} latest={feed.latest} connection={feed.connection} />
      <section role="status" style={{padding:"12px 24px", background:feed.latest?.risk?.halted ? "#fff0ee" : "#f3f0fb", color:"#43356b", borderBottom:"1px solid #e5e1ee", fontSize:13}}>
        <strong>Paper trading only.</strong> No wallet or real orders. Simulated results are not a profitability forecast.
        {feed.latest?.risk && <span style={{display:"block",marginTop:4}}>Status: {feed.latest.risk.halted ? "HALTED" : "Monitoring"} | {feed.latest.risk.reason?.replaceAll("_", " ") ?? "risk checks passed"} | Model calls: {feed.latest.risk.modelCalls}</span>}
      </section>
      <StatsRow latest={feed.latest} avgLatencyMs={feed.avgLatencyMs} meta={feed.meta} />
      <div className={styles.main}>
        <div className={styles.left}>
          <div className={styles.chartWrap}>
            <FlowChart events={feed.events} latest={feed.latest} />
          </div>
        </div>
        <div className={styles.right}>
          <DecisionPanel latest={feed.latest} />
          <Feed events={feed.events} />
        </div>
      </div>
    </div>
  );
}

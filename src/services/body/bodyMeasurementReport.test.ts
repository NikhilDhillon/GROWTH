import { describe, expect, it } from "vitest";
import { buildBodyMeasurementReport, filterBodyMeasurementLogs } from "./bodyMeasurementReport";
import type { BodyMeasurementLog, BodyMeasurementValues } from "@/types";
function log(id:number,date:string,measurements:BodyMeasurementValues):BodyMeasurementLog{return {id,weight:170,measurements,logged_date:date,logged_at:`${date}T12:00:00Z`,created_at:`${date}T12:00:00Z`,updated_at:`${date}T12:00:00Z`};}
const cutoff="2026-10-09";
describe("tape observation comparisons",()=>{
  it("keeps single, left and right baselines separate instead of averaging across changing modes",()=>{
    const reports=buildBodyMeasurementReport([
      log(1,"2026-01-01",{arm_flexed:{mode:"single",value:34}}),
      log(2,"2026-05-01",{arm_flexed:{mode:"sides",left:30,right:40}}),
      log(3,"2026-09-01",{arm_flexed:{mode:"sides",left:32,right:41}})
    ],"arm_flexed",cutoff);
    expect(reports.map(({channel,start,latest,changeFromStartCm})=>({channel,start:start.valueCm,latest:latest.valueCm,change:changeFromStartCm}))).toEqual([
      {channel:"single",start:34,latest:34,change:0},{channel:"left",start:30,latest:32,change:2},{channel:"right",start:40,latest:41,change:1}
    ]);
    expect(reports[0].previous).toBeNull();
  });
  it("never substitutes the opposite side when one side was not measured",()=>{
    const reports=buildBodyMeasurementReport([
      log(1,"2026-01-01",{thigh:{mode:"sides",left:50}}),
      log(2,"2026-05-01",{thigh:{mode:"sides",right:55}}),
      log(3,"2026-09-01",{thigh:{mode:"sides",left:49}})
    ],"thigh",cutoff);
    const left=reports.find((r)=>r.channel==="left")!;const right=reports.find((r)=>r.channel==="right")!;
    expect(left.points.map((p)=>p.checkInId)).toEqual([1,3]);expect(left.changeFromPreviousCm).toBe(-1);
    expect(right.points.map((p)=>p.checkInId)).toEqual([2]);expect(right.previous).toBeNull();
  });
  it("retains every rare observation on its actual date even when observations share a month",()=>{
    const logs=[log(1,"2026-01-01",{waist:80}),log(2,"2026-01-20",{waist:78})];
    const reports=buildBodyMeasurementReport(filterBodyMeasurementLogs(logs,"year",cutoff),"waist",cutoff);
    expect(reports[0].points).toEqual([{checkInId:1,date:"2026-01-01",valueCm:80},{checkInId:2,date:"2026-01-20",valueCm:78}]);
  });
  it("uses chronological first, previous and latest observations without mutating input order",()=>{
    const logs=[log(3,"2026-09-01",{chest:102}),log(1,"2026-01-01",{chest:98}),log(2,"2026-05-01",{chest:101})];
    const report=buildBodyMeasurementReport(logs,"chest",cutoff)[0];
    expect([report.start.checkInId,report.previous?.checkInId,report.latest.checkInId]).toEqual([1,2,3]);
    expect(report.changeFromStartCm).toBe(4);expect(report.changeFromPreviousCm).toBe(1);expect(logs.map((r)=>r.id)).toEqual([3,1,2]);
  });
  it("does not forward-fill tape values across daily weight-only check-ins",()=>{
    const report=buildBodyMeasurementReport([log(1,"2026-01-01",{waist:80}),log(2,"2026-01-02",{}),log(3,"2026-01-03",{})],"waist",cutoff)[0];
    expect(report.points).toHaveLength(1);expect(report.latest.date).toBe("2026-01-01");expect(report.previous).toBeNull();
  });
  it("excludes future and invalid calendar observations from every range and baseline",()=>{
    const logs=[log(1,"2026-01-01",{waist:80}),log(2,"2026-12-01",{waist:90}),log(3,"2026-02-30",{waist:85})];
    expect(filterBodyMeasurementLogs(logs,"all",cutoff).map((r)=>r.id)).toEqual([1]);
    expect(buildBodyMeasurementReport(logs,"waist",cutoff)[0].latest.checkInId).toBe(1);
  });
  it("does not let an invalid numeric channel poison other observed channels",()=>{
    const reports=buildBodyMeasurementReport([log(1,"2026-01-01",{calves:{mode:"sides",left:Number.NaN,right:35}}),log(2,"2026-05-01",{calves:{mode:"sides",left:-1,right:36}})],"calves",cutoff);
    expect(reports.map((r)=>r.channel)).toEqual(["right"]);expect(reports[0].changeFromStartCm).toBe(1);
  });
  it("reports signed changes without assuming increases or decreases are improvement",()=>{
    expect(buildBodyMeasurementReport([log(1,"2026-01-01",{waist:80}),log(2,"2026-05-01",{waist:78})],"waist",cutoff)[0].changeFromStartCm).toBe(-2);
    expect(buildBodyMeasurementReport([log(1,"2026-01-01",{waist:80}),log(2,"2026-05-01",{waist:82})],"waist",cutoff)[0].changeFromStartCm).toBe(2);
  });
  it("includes exact calendar range boundaries around daylight-saving dates",()=>{
    expect(filterBodyMeasurementLogs([log(1,"2026-03-08",{waist:80}),log(2,"2026-03-09",{waist:81}),log(3,"2026-03-15",{waist:82}),log(4,"2026-03-16",{waist:83})],"week","2026-03-15").map((r)=>r.id)).toEqual([2,3]);
  });
  it("returns no invented observation when a metric has not been measured",()=>{
    expect(buildBodyMeasurementReport([log(1,"2026-01-01",{waist:80})],"chest",cutoff)).toEqual([]);
  });
});

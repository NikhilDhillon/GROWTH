import { describe, expect, it } from "vitest";
import { buildAverageMeasurementReport, buildBodyMeasurementOverview, buildBodyMeasurementReport, buildBodyMeasurementSeries, currentMeasurementChannels, filterBodyMeasurementLogs, overviewOrder } from "./bodyMeasurementReport";
import { bodyMeasurementDefinitions } from "@/utils/bodyMeasurements";
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
describe("all body parts overview",()=>{
  const row=(overview:ReturnType<typeof buildBodyMeasurementOverview>,key:string)=>overview.rows.find((item)=>item.key===key)!;
  it("gives every measured body part one row and names the ones never measured",()=>{
    const overview=buildBodyMeasurementOverview([log(1,"2026-01-01",{waist:80,chest:100}),log(2,"2026-06-01",{thigh:{mode:"single",value:55}})],"all",cutoff);
    expect(overview.rows.map((item)=>item.key).sort()).toEqual(["chest","thigh","waist"]);
    expect(overview.unmeasured).toEqual(expect.arrayContaining(["Calves","Forearm","Abdomen"]));
    expect(overview.unmeasured).not.toContain("Chest");
  });
  it("keeps sides on one row without averaging them",()=>{
    const overview=buildBodyMeasurementOverview([log(1,"2026-01-01",{arm_flexed:{mode:"sides",left:30,right:40}}),log(2,"2026-05-01",{arm_flexed:{mode:"sides",left:32,right:41}})],"all",cutoff);
    expect(row(overview,"arm_flexed").channels.map(({channel,changeCm})=>({channel,changeCm}))).toEqual([{channel:"left",changeCm:2},{channel:"right",changeCm:1}]);
  });
  it("shares one date window and one scale so rows can be compared directly",()=>{
    const overview=buildBodyMeasurementOverview([log(1,"2026-01-01",{waist:80,chest:100}),log(2,"2026-05-01",{waist:77,chest:101}),log(3,"2026-09-01",{chest:104})],"all",cutoff);
    expect(overview.window).toEqual({start:"2026-01-01",end:"2026-09-01"});
    expect(overview.changeDomainCm).toEqual({min:-3,max:4});
  });
  it("scales to the change a row shows, not a spike between its entries",()=>{
    const overview=buildBodyMeasurementOverview([log(1,"2026-01-01",{chest:100}),log(2,"2026-05-01",{chest:110}),log(3,"2026-09-01",{chest:101})],"all",cutoff);
    expect(overview.changeDomainCm).toEqual({min:0,max:1});
  });
  it("lists every body part from the top of the body down",()=>{
    expect([...overviewOrder].sort()).toEqual(bodyMeasurementDefinitions.map((item)=>item.key).sort());
    const overview=buildBodyMeasurementOverview([log(1,"2026-01-01",{calves:{mode:"single",value:35},waist:80,abdomen:85,chest:100,thinnest_waist:75})],"all",cutoff);
    expect(overview.rows.map((item)=>item.key)).toEqual(["chest","thinnest_waist","waist","abdomen","calves"]);
  });
  it("measures change inside the range but still reports the newest value on record",()=>{
    const overview=buildBodyMeasurementOverview([log(1,"2026-01-01",{waist:90,chest:100}),log(2,"2026-09-20",{waist:86}),log(3,"2026-10-01",{waist:84})],"month",cutoff);
    const waist=row(overview,"waist").channels[0];
    expect(waist.points.map((point)=>point.checkInId)).toEqual([2,3]);
    expect(waist.changeCm).toBe(-2);
    const chest=row(overview,"chest").channels[0];
    expect(chest.points).toEqual([]);expect(chest.changeCm).toBeNull();expect(chest.latest.date).toBe("2026-01-01");
  });
  it("reports no change from a single entry rather than inventing one",()=>{
    const overview=buildBodyMeasurementOverview([log(1,"2026-09-01",{waist:80})],"all",cutoff);
    expect(row(overview,"waist").channels[0].changeCm).toBeNull();
    expect(overview.changeDomainCm).toEqual({min:0,max:0});
  });
  it("has no window when nothing falls inside the range",()=>{
    expect(buildBodyMeasurementOverview([log(1,"2026-01-01",{waist:80})],"week",cutoff).window).toBeNull();
    expect(buildBodyMeasurementOverview([],"all",cutoff)).toMatchObject({rows:[],window:null});
  });
});
describe("parts that switched between one value and left and right",()=>{
  const switched=[log(1,"2026-01-01",{thigh:{mode:"single",value:60}}),log(2,"2026-03-01",{thigh:{mode:"single",value:58}}),log(3,"2026-06-01",{thigh:{mode:"sides",left:54,right:56}})];
  it("joins single values with the average of left and right",()=>{
    const report=buildAverageMeasurementReport(switched,"thigh",cutoff)!;
    expect(report.points.map((point)=>point.valueCm)).toEqual([60,58,55]);
    expect(report.changeFromStartCm).toBe(-5);
  });
  it("does not average a part always measured left and right",()=>{
    const logs=[log(1,"2026-01-01",{thigh:{mode:"sides",left:50,right:60}}),log(2,"2026-06-01",{thigh:{mode:"sides",left:51,right:62}})];
    expect(buildAverageMeasurementReport(logs,"thigh",cutoff)).toBeNull();
    const row=buildBodyMeasurementOverview(logs,"all",cutoff).rows[0];
    expect(row.average).toBeNull();
    expect(row.channels.map((channel)=>channel.changeCm)).toEqual([1,2]);
  });
  it("never lets one side stand in for the average",()=>{
    const logs=[log(1,"2026-01-01",{thigh:{mode:"single",value:60}}),log(2,"2026-03-01",{thigh:{mode:"sides",left:54}}),log(3,"2026-06-01",{thigh:{mode:"sides",left:54,right:56}})];
    expect(buildAverageMeasurementReport(logs,"thigh",cutoff)!.points.map((point)=>point.checkInId)).toEqual([1,3]);
    expect(buildAverageMeasurementReport([logs[0],logs[1]],"thigh",cutoff)).toBeNull();
  });
  it("shows one average change and today's sizes on the row",()=>{
    const overview=buildBodyMeasurementOverview(switched,"all",cutoff);
    const row=overview.rows[0];
    expect(row.average?.changeCm).toBe(-5);
    expect(currentMeasurementChannels(row).map((channel)=>channel.channel)).toEqual(["left","right"]);
    expect(overview.changeDomainCm).toEqual({min:-5,max:0});
  });
  it("shows the single value as today's size when that is the newest way it was measured",()=>{
    const back=[...switched,log(4,"2026-09-01",{thigh:{mode:"single",value:57}})];
    expect(currentMeasurementChannels(buildBodyMeasurementOverview(back,"all",cutoff).rows[0]).map((channel)=>channel.channel)).toEqual(["single"]);
  });
  it("only averages when the range itself mixes the two",()=>{
    const row=buildBodyMeasurementOverview([...switched,log(4,"2026-09-20",{thigh:{mode:"sides",left:55,right:57}})],"month",cutoff).rows[0];
    expect(row.average).toBeNull();
    expect(row.channels.find((channel)=>channel.channel==="left")?.points).toHaveLength(1);
  });
  it("offers the joined history first in the chart, keeping the separate ones",()=>{
    expect(buildBodyMeasurementSeries(switched,"thigh",cutoff).map((series)=>series.channel)).toEqual(["average","single","left","right"]);
    expect(buildBodyMeasurementSeries([switched[0]],"thigh",cutoff).map((series)=>series.channel)).toEqual(["single"]);
  });
});

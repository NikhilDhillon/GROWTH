import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BodyCheckInWriteInput } from "@/domain/bodyCheckInRecording";
import type { BodyMeasurementLog } from "@/types";
const cloud=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),auth:{getUser:vi.fn()}}));
vi.mock("@supabase/supabase-js",()=>({createClient:()=>cloud}));
const key="growth.preview.database.v2";
const timestamp="2026-10-01T12:00:00.000Z";
const row:BodyMeasurementLog={id:10,weight:170,measurements:{waist:80},notes:"Observed",logged_date:"2026-10-01",logged_at:timestamp,created_at:timestamp,updated_at:timestamp};
let storage:Map<string,string>,failWrite:boolean;
const request=(n:number)=>`50000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
function input(overrides:Partial<BodyCheckInWriteInput>={}):BodyCheckInWriteInput{return {requestId:request(1),loggedDate:"2026-10-02",weight:171,measurements:{waist:81},inputUnits:{weight:"lb",circumference:"cm"},...overrides};}
function persisted(){return JSON.parse(storage.get(key)!);}
async function adapter(isCloud=false){vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL",isCloud?"https://example.test":"");vi.stubEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY",isCloud?"test":"");vi.resetModules();return import("@/database/database.web");}
beforeEach(()=>{
  storage=new Map([[key,JSON.stringify({bodyMeasurementLogs:[row],bodyMeasurementMigration:"modern_authority",retiredActiveWorkouts:[],bodyWeightLogs:[],currentUserId:1})]]);failWrite=false;
  let queue=Promise.resolve();vi.stubGlobal("navigator",{locks:{request:(_key:string,action:()=>unknown)=>{const next=queue.then(action);queue=next.then(()=>undefined,()=>undefined);return next;}}});
  vi.stubGlobal("window",{localStorage:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,value:string)=>{if(failWrite)throw new Error("Storage unavailable");storage.set(k,value);}}});
  cloud.rpc.mockReset();cloud.from.mockReset();cloud.auth.getUser.mockReset();cloud.auth.getUser.mockResolvedValue({data:{user:{id:"owner"}},error:null});cloud.from.mockImplementation(()=>{throw new Error("Direct table mutations forbidden in this test");});
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("atomic browser whole body check-ins",()=>{
  it("records a complete row and receipt in one commit and preserves original unit evidence",async()=>{
    const web=await adapter();const saved=await web.recordBodyCheckIn(input());expect(saved).toMatchObject({weight:171,measurements:{waist:81},weight_input_unit:"lb",circumference_input_unit:"cm"});
    expect(persisted().bodyMeasurementLogs).toHaveLength(2);expect(Object.values(persisted().bodyCheckInWriteRequests)).toHaveLength(1);
    expect(await web.recordBodyCheckIn(input())).toEqual(saved);expect(persisted().bodyMeasurementLogs).toHaveLength(2);
  });
  it("rejects an occupied date without merging observations",async()=>{
    const web=await adapter();const before=storage.get(key);await expect(web.recordBodyCheckIn(input({loggedDate:row.logged_date,measurements:{chest:100}}))).rejects.toMatchObject({name:"BodyCheckInConflictError"});expect(storage.get(key)).toBe(before);
  });
  it("rejects stale facts even when a legacy writer left the timestamp unchanged",async()=>{
    const data=persisted();data.bodyMeasurementLogs[0].weight=190;storage.set(key,JSON.stringify(data));const web=await adapter();const before=storage.get(key);
    await expect(web.recordBodyCheckIn(input({id:row.id,expected:row,loggedDate:row.logged_date}))).rejects.toMatchObject({name:"BodyCheckInConflictError"});expect(storage.get(key)).toBe(before);
  });
  it("rejects deleted records rather than turning an edit into a create",async()=>{
    const data=persisted();data.bodyMeasurementLogs=[];storage.set(key,JSON.stringify(data));const web=await adapter();await expect(web.recordBodyCheckIn(input({id:row.id,expected:row}))).rejects.toMatchObject({name:"BodyCheckInConflictError"});expect(persisted().bodyMeasurementLogs).toEqual([]);
  });
  it("replaces the whole edited observation and makes explicit field removal durable",async()=>{
    const web=await adapter();const saved=await web.recordBodyCheckIn(input({id:row.id,expected:row,loggedDate:row.logged_date,measurements:{}}));expect(saved.measurements).toEqual({});expect(saved.circumference_input_unit).toBeNull();expect(persisted().bodyMeasurementLogs).toHaveLength(1);
  });
  it("preserves historical unknown tape units when only weight changes",async()=>{
    const web=await adapter();const saved=await web.recordBodyCheckIn(input({id:row.id,expected:row,loggedDate:row.logged_date,measurements:row.measurements}));expect(saved.weight_input_unit).toBe("lb");expect(saved.circumference_input_unit).toBeNull();
  });
  it("does not invent one tape input unit for a mixture of unchanged unknown and new values",async()=>{
    const web=await adapter();const saved=await web.recordBodyCheckIn(input({id:row.id,expected:row,loggedDate:row.logged_date,weight:row.weight,measurements:{...row.measurements,chest:100}}));expect(saved.weight_input_unit).toBeNull();expect(saved.circumference_input_unit).toBeNull();
  });
  it("successful retries return current facts after a later edit without replaying older values",async()=>{
    const web=await adapter();const created=await web.recordBodyCheckIn(input());const edited=await web.recordBodyCheckIn(input({requestId:request(2),id:created.id,expected:created,weight:180}));expect(await web.recordBodyCheckIn(input())).toEqual(edited);expect(persisted().bodyMeasurementLogs.find((r:BodyMeasurementLog)=>r.id===created.id).weight).toBe(180);
  });
  it("deletes the whole row and permanently rejects old capture retries",async()=>{
    const web=await adapter();const saved=await web.recordBodyCheckIn(input());await web.deleteBodyCheckIn(saved.id,saved);await expect(web.recordBodyCheckIn(input())).rejects.toMatchObject({name:"BodyCheckInConflictError"});expect(persisted().bodyMeasurementLogs).toEqual([row]);
    const next=await web.recordBodyCheckIn(input({requestId:request(2)}));expect(next.id).toBeGreaterThan(saved.id);
  });
  it("keeps failed writes and deletions from changing saved observations or receipts",async()=>{
    const web=await adapter();const before=storage.get(key);failWrite=true;await expect(web.recordBodyCheckIn(input())).rejects.toThrow(/Storage unavailable/);expect(storage.get(key)).toBe(before);
    await expect(web.deleteBodyCheckIn(row.id,row)).rejects.toThrow(/Storage unavailable/);expect(storage.get(key)).toBe(before);
  });
  it("rejects deleting a stale whole snapshot",async()=>{
    const web=await adapter();await expect(web.deleteBodyCheckIn(row.id,{...row,measurements:{waist:79}})).rejects.toMatchObject({name:"BodyCheckInConflictError"});expect(persisted().bodyMeasurementLogs).toEqual([row]);
  });
  it("serializes repeated mobile taps into one recorded observation",async()=>{
    const web=await adapter();const rows=await Promise.all([web.recordBodyCheckIn(input()),web.recordBodyCheckIn(input())]);expect(rows[0].id).toBe(rows[1].id);expect(persisted().bodyMeasurementLogs).toHaveLength(2);
  });
  it("rejects changing a pending attempt payload",async()=>{
    const web=await adapter();await web.recordBodyCheckIn(input());const before=storage.get(key);await expect(web.recordBodyCheckIn(input({weight:999}))).rejects.toThrow(/different values/);expect(storage.get(key)).toBe(before);
  });
  it("does not erase unrelated raw historical evidence when a new check-in is saved",async()=>{
    const ambiguous={...row,measurements:{waist:80,obsolete_raw:123},extra_evidence:"retain"};const data=persisted();data.bodyMeasurementLogs=[ambiguous];storage.set(key,JSON.stringify(data));const web=await adapter();await web.recordBodyCheckIn(input());expect(persisted().bodyMeasurementLogs.find((r:BodyMeasurementLog)=>r.id===row.id)).toEqual(ambiguous);
    await expect(web.recordBodyCheckIn(input({requestId:request(2),id:row.id,expected:row}))).rejects.toMatchObject({name:"BodyCheckInConflictError"});
  });
  it("uses account-scoped receipts",async()=>{
    const web=await adapter();await web.recordBodyCheckIn(input());const data=persisted();data.currentUserId=2;storage.set(key,JSON.stringify(data));await expect(web.recordBodyCheckIn(input())).rejects.toMatchObject({name:"BodyCheckInConflictError"});expect(Object.keys(persisted().bodyCheckInWriteRequests)).toEqual([`1:${request(1)}`]);
  });
  it("rejects a create when the account bound to the open form has changed",async()=>{
    const web=await adapter();const before=storage.get(key);await expect(web.recordBodyCheckIn(input({accountId:2}))).rejects.toMatchObject({name:"BodyCheckInConflictError"});expect(storage.get(key)).toBe(before);
  });
  it("rejects a deletion after the initiating account changes",async()=>{
    const web=await adapter();const before=storage.get(key);await expect(web.deleteBodyCheckIn(row.id,row,2)).rejects.toMatchObject({name:"BodyCheckInConflictError"});expect(storage.get(key)).toBe(before);
  });
  it("preserves corrupted retry evidence instead of treating an old attempt as a new capture",async()=>{
    const web=await adapter();const saved=await web.recordBodyCheckIn(input());await web.deleteBodyCheckIn(saved.id,saved);const data=persisted();data.bodyCheckInWriteRequests=[];storage.set(key,JSON.stringify(data));const before=storage.get(key);
    await expect(web.recordBodyCheckIn(input())).rejects.toThrow(/retry evidence.*preserved/);expect(storage.get(key)).toBe(before);expect(persisted().bodyMeasurementLogs).toEqual([row]);
  });
});
describe("cloud whole check-in authority boundary",()=>{
  it("uses one RPC with exact snapshot and explicit units",async()=>{
    const web=await adapter(true);cloud.rpc.mockResolvedValue({data:{...row,weight:171,weight_input_unit:"kg",circumference_input_unit:null},error:null});
    const saved=await web.recordBodyCheckIn(input({id:row.id,expected:row,inputUnits:{weight:"kg",circumference:"in"}}));expect(cloud.rpc).toHaveBeenCalledOnce();expect(cloud.rpc.mock.calls[0]).toMatchObject(["record_body_check_in",{p_input:{id:row.id,expected:{id:row.id,measurements:row.measurements,weight_input_unit:null},requestId:request(1),inputUnits:{weight:"kg",circumference:"in"}}}]);expect(saved.weight_input_unit).toBe("kg");expect(cloud.from).not.toHaveBeenCalled();
  });
  it("communicates missing deployment rather than attempting a direct fallback",async()=>{
    const web=await adapter(true);cloud.rpc.mockResolvedValue({data:null,error:{code:"PGRST202",message:"RPC missing"}});await expect(web.recordBodyCheckIn(input())).rejects.toThrow(/Phase 5 body check-in.*previous data.*preserved/);expect(cloud.from).not.toHaveBeenCalled();
  });
  it("keeps confirmed conflicts distinct from ambiguous network failures",async()=>{
    const web=await adapter(true);cloud.rpc.mockResolvedValue({data:null,error:{message:"This body check-in changed elsewhere. Reload before editing it."}});await expect(web.recordBodyCheckIn(input())).rejects.toMatchObject({name:"BodyCheckInConflictError"});
    cloud.rpc.mockRejectedValue(new Error("Network disconnected"));await expect(web.recordBodyCheckIn(input())).rejects.toThrow(/Network disconnected/);
  });
  it("uses a whole-delete RPC with the saved snapshot and communicates rejection",async()=>{
    const web=await adapter(true);cloud.rpc.mockResolvedValue({data:null,error:{message:"This body check-in changed elsewhere. Reload before deleting it."}});await expect(web.deleteBodyCheckIn(row.id,row)).rejects.toMatchObject({name:"BodyCheckInConflictError"});expect(cloud.rpc.mock.calls[0][0]).toBe("delete_body_check_in");expect(cloud.rpc.mock.calls[0][1].p_expected.measurements).toEqual(row.measurements);
  });
  it("rejects an account switch before dispatching the capture RPC",async()=>{
    const web=await adapter(true);await expect(web.recordBodyCheckIn(input({accountId:"another-owner"}))).rejects.toMatchObject({name:"BodyCheckInConflictError"});expect(cloud.rpc).not.toHaveBeenCalled();
  });
  it("binds deletion to its initiating account before RPC dispatch",async()=>{
    const web=await adapter(true);await expect(web.deleteBodyCheckIn(row.id,row,"another-owner")).rejects.toMatchObject({name:"BodyCheckInConflictError"});expect(cloud.rpc).not.toHaveBeenCalled();
    cloud.rpc.mockResolvedValue({data:null,error:null});await web.deleteBodyCheckIn(row.id,row,"owner");expect(cloud.rpc.mock.calls[0][1].p_expected_account).toBe("owner");
  });
});

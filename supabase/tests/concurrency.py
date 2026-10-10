"""Behavioral race checks against run-phase1.sh's throwaway PostgreSQL only."""

import concurrent.futures
import pathlib
import re
import subprocess
import sys


socket = pathlib.Path(sys.argv[1]).absolute()
command = ["psql", "-X", "-h", str(socket), "-p", "55439", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"]
A = "00000000-0000-0000-0000-000000000001"
B = "00000000-0000-0000-0000-000000000002"
C = "00000000-0000-0000-0000-000000000003"
D = "00000000-0000-0000-0000-000000000004"


def execute(sql, user=None):
    if user:
        sql = f"begin; set local role authenticated; set local request.jwt.claim.role = 'authenticated'; set local request.jwt.claim.sub = '{user}'; {sql} commit;"
    return subprocess.run(command, input=sql, text=True, capture_output=True, timeout=20)


def succeeds(sql, user=None):
    result = execute(sql, user)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def race(actors):
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(actors)) as executor:
        return list(executor.map(lambda actor: execute(actor[1], actor[0]), actors))


assert socket.name == "socket" and socket.parent.name.startswith("growth-phase1-postgres"), "Use the isolated test runner."
actual_directory = pathlib.Path(succeeds("select current_setting('data_directory');")).resolve()
assert actual_directory == (socket.parent / "data").resolve(), "Refusing an unrelated PostgreSQL server."

request = "20000000-0000-0000-0000-000000000001"
save = f"select public.save_workout_session(1, '2026-10-08', 'concurrent-save', null, '[{{\"reps\":5,\"weight\":100}}]', null, '{request}'); select pg_sleep(0.1);"
results = race([(A, save), (A, save)])
assert all(result.returncode == 0 for result in results), [result.stderr for result in results]
ids = [re.findall(r"^\d+$", result.stdout, flags=re.MULTILINE) for result in results]
assert len(ids[0]) == 1 and ids[0] == ids[1], "Concurrent same-key saves must return one ID."
assert succeeds(f"select count(*) from public.workout_sessions where user_id = '{A}' and notes = 'concurrent-save';") == "1"

request = "20000000-0000-0000-0000-000000000002"
saves = [f"select public.save_workout_session(1, '2026-10-08', 'concurrent-conflict', null, '[{{\"reps\":5,\"weight\":{weight}}}]', null, '{request}'); select pg_sleep(0.1);" for weight in (100, 101)]
results = race([(A, save) for save in saves])
assert sum(result.returncode == 0 for result in results) == 1, "One request cannot commit two payloads."
assert any("different observations" in result.stderr for result in results)
assert succeeds(f"select count(*) from public.workout_sessions where user_id = '{A}' and notes = 'concurrent-conflict';") == "1"

succeeds(f"insert into public.friend_invites (owner_id, token, expires_at) values ('{D}', 'concurrent-invite', now() + interval '1 day');")
results = race([(user, "select public.accept_friend_invite('concurrent-invite'); select pg_sleep(0.1);") for user in (B, C)])
assert sum(result.returncode == 0 for result in results) == 1, "A bearer invitation is single use."
assert any("already been used" in result.stderr for result in results)
assert succeeds(f"select count(*) from public.friendships where user_low = '{D}' or user_high = '{D}';") == "1"

succeeds("select public.save_active_workout('{\"startedAt\":\"concurrent-finish\"}');", A)
finish = "select public.finalize_active_workout('concurrent-finish', '[{\"id\":\"concurrent-finish\",\"startedAt\":\"concurrent-finish\"}]', '{\"startedAt\":\"concurrent-finish\"}'); select pg_sleep(0.1);"
late_save = "select public.save_active_workout('{\"startedAt\":\"concurrent-finish\",\"notes\":\"late tab\"}'); select pg_sleep(0.1);"
results = race([(A, finish), (A, late_save)])
if results[0].returncode == 0:
    assert results[1].returncode != 0 and "already finished or discarded" in results[1].stderr
    assert succeeds(f"select count(*) from public.app_settings where user_id = '{A}' and key = 'active_workout';") == "0"
    assert succeeds(f"select count(*) from public.active_workout_retirements where user_id = '{A}' and workout_id = 'concurrent-finish';") == "1"
else:
    assert "active workout changed" in results[0].stderr and results[1].returncode == 0
    assert succeeds(f"select value::jsonb->>'notes' from public.app_settings where user_id = '{A}' and key = 'active_workout';") == "late tab"
    assert succeeds(f"select count(*) from public.active_workout_retirements where user_id = '{A}' and workout_id = 'concurrent-finish';") == "0"
    succeeds("select public.finalize_active_workout('concurrent-finish', null, '{\"startedAt\":\"concurrent-finish\",\"notes\":\"late tab\"}');", A)

# Two clients hold the same startedAt. Once one has saved new entered values,
# the older client's completion must leave those values and retirement intact.
succeeds("select public.save_active_workout('{\"startedAt\":\"concurrent-snapshot\",\"notes\":\"old client\"}');", A)
result = execute("select public.save_active_workout('{\"startedAt\":\"concurrent-snapshot\",\"notes\":\"newer client\"}');", A)
assert result.returncode == 0, result.stderr
result = execute("select public.finalize_active_workout('concurrent-snapshot', null, '{\"startedAt\":\"concurrent-snapshot\",\"notes\":\"old client\"}');", A)
assert result.returncode != 0 and "active workout changed" in result.stderr
assert succeeds(f"select value::jsonb->>'notes' from public.app_settings where user_id = '{A}' and key = 'active_workout';") == "newer client"
assert succeeds(f"select count(*) from public.active_workout_retirements where user_id = '{A}' and workout_id = 'concurrent-snapshot';") == "0"
succeeds("select public.finalize_active_workout('concurrent-snapshot', null, '{\"startedAt\":\"concurrent-snapshot\",\"notes\":\"newer client\"}');", A)

X, Y, Z = [f"00000000-0000-0000-0000-{value:012d}" for value in (11, 12, 13)]
succeeds(f"""
  insert into auth.users values ('{X}'), ('{Y}'), ('{Z}');
  insert into public.friendships (requester_id, addressee_id, status) values ('{X}', '{Y}', 'accepted'), ('{X}', '{Z}', 'accepted'), ('{Y}', '{Z}', 'accepted');
  insert into public.split_sync_requests (requester_id, addressee_id, status) values ('{X}', '{Y}', 'accepted'), ('{X}', '{Z}', 'accepted'), ('{Y}', '{Z}', 'accepted');
  insert into public.shared_training_splits (user_id, split_days, updated_by_name) values ('{X}', '[\"before\"]', 'X'), ('{Y}', '[\"before\"]', 'Y'), ('{Z}', '[\"before\"]', 'Z');
""")
results = race([(X, "select public.save_shared_training_split('[\"concurrent\"]'); select pg_sleep(0.1);"), (X, f"select public.remove_friend('{Y}'); select pg_sleep(0.1);")])
assert all(result.returncode == 0 for result in results), [result.stderr for result in results]
previous = succeeds(f"select split_days from public.shared_training_splits where user_id = '{Y}';")
succeeds("select public.save_shared_training_split('[\"after-revocation\"]');", X)
assert succeeds(f"select split_days from public.shared_training_splits where user_id = '{Y}';") == previous, "No indirect post-revocation propagation."
assert succeeds(f"select count(*) from public.split_sync_requests where user_low = '{X}' and user_high = '{Y}';") == "0"

print("Concurrent/multiple-client save/consent/finish/revocation scenarios passed: 6")

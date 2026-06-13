import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Check, Copy, Link, RefreshCw, Share2, Trash2, Trophy, UserPlus, Users, X } from "lucide-react-native";

import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { useFitnessStore } from "@/store/useFitnessStore";
import { LeaderboardEntry } from "@/types";
import { formatShortDate } from "@/utils/date";
import { palette, spacing } from "@/utils/theme";
import { pressableFeedback } from "@/utils/touch";

type SocialTab = "leaderboard" | "friends" | "invite";

const tabs: Array<{ key: SocialTab; label: string }> = [
  { key: "leaderboard", label: "Leaderboard" },
  { key: "friends", label: "Friends" },
  { key: "invite", label: "Invite" }
];

export function SocialScreen() {
  const currentUser = useFitnessStore((state) => state.currentUser);
  const exercises = useFitnessStore((state) => state.exercises);
  const socialData = useFitnessStore((state) => state.socialData);
  const socialLoading = useFitnessStore((state) => state.socialLoading);
  const socialError = useFitnessStore((state) => state.socialError);
  const lastInviteUrl = useFitnessStore((state) => state.lastInviteUrl);
  const loadSocial = useFitnessStore((state) => state.loadSocial);
  const createFriendInvite = useFitnessStore((state) => state.createFriendInvite);
  const acceptFriendInvite = useFitnessStore((state) => state.acceptFriendInvite);
  const revokeFriendInvite = useFitnessStore((state) => state.revokeFriendInvite);
  const removeFriend = useFitnessStore((state) => state.removeFriend);
  const trainingSplit = useFitnessStore((state) => state.trainingSplit);
  const requestSplitSync = useFitnessStore((state) => state.requestSplitSync);
  const respondSplitSync = useFitnessStore((state) => state.respondSplitSync);
  const removeSplitSync = useFitnessStore((state) => state.removeSplitSync);
  const [tab, setTab] = useState<SocialTab>("leaderboard");
  const [selectedExerciseId, setSelectedExerciseId] = useState(0);
  const [inviteCode, setInviteCode] = useState("");
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const availableExerciseIds = useMemo(() => {
    const idsFromScores = new Set(socialData.leaderboard.map((entry) => entry.exercise_id));
    const strengthIds = exercises.filter((exercise) => exercise.is_strength_exercise).map((exercise) => exercise.id);
    return [...new Set([...strengthIds, ...idsFromScores])];
  }, [exercises, socialData.leaderboard]);

  useEffect(() => {
    void loadSocial();
  }, [loadSocial]);

  useEffect(() => {
    if (!selectedExerciseId && availableExerciseIds.length) {
      setSelectedExerciseId(availableExerciseIds[0]);
    }
  }, [availableExerciseIds, selectedExerciseId]);

  const selectedExercise = exercises.find((exercise) => exercise.id === selectedExerciseId);
  const selectedEntries = socialData.leaderboard
    .filter((entry) => entry.exercise_id === selectedExerciseId)
    .sort((a, b) => b.best_estimated_1rm - a.best_estimated_1rm || a.name.localeCompare(b.name));
  const acceptedFriends = socialData.friends.filter((friend) => friend.status === "accepted");
  const pendingFriends = socialData.friends.filter((friend) => friend.status === "pending");
  const inviteValue = lastInviteUrl ?? socialData.invites[0]?.invite_url ?? "";

  async function copyInvite(value: string) {
    if (!value) return;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      setCopyNotice("Invite copied.");
    } else {
      setCopyNotice("Copy the invite shown below.");
    }
  }

  async function shareInvite(value: string) {
    if (!value) return;
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ title: "Join my GROWTH leaderboard", url: value });
    } else {
      await copyInvite(value);
    }
  }

  async function acceptCode() {
    const token = inviteCode.trim();
    if (!token) return;
    await acceptFriendInvite(token);
    setInviteCode("");
  }

  return (
    <Screen>
      <View>
        <Label>Friends, opt-in split sync and exercise PRs</Label>
        <Title>Social</Title>
      </View>

      <Panel>
        <View style={styles.segmentRow}>
          {tabs.map((item) => (
            <Pressable key={item.key} onPress={() => setTab(item.key)} style={[styles.segmentButton, tab === item.key && styles.segmentButtonActive]}>
              <Body style={[styles.segmentText, tab === item.key && styles.segmentTextActive]}>{item.label}</Body>
            </Pressable>
          ))}
        </View>
      </Panel>

      {socialData.notice ? (
        <Panel>
          <SectionTitle>Cloud sync required</SectionTitle>
          <Body>{socialData.notice}</Body>
        </Panel>
      ) : null}

      {socialError ? (
        <Panel>
          <SectionTitle>Social unavailable</SectionTitle>
          <Body>{socialError}</Body>
        </Panel>
      ) : null}

      {tab === "leaderboard" ? (
        <>
          <Panel>
            <View style={styles.panelHeader}>
              <View>
                <SectionTitle>Exercise</SectionTitle>
                <Body>{acceptedFriends.length ? `${acceptedFriends.length} friends connected` : "Invite friends to compare best e1RM results."}</Body>
              </View>
              <Pressable accessibilityRole="button" onPress={() => void loadSocial()} style={pressableFeedback(styles.iconButton)}>
                {socialLoading ? <ActivityIndicator color={palette.ink} /> : <RefreshCw size={18} color={palette.ink} />}
              </Pressable>
            </View>
            <View style={styles.chipRow}>
              {availableExerciseIds.map((exerciseId) => {
                const exercise = exercises.find((item) => item.id === exerciseId);
                const label = exercise?.name ?? socialData.leaderboard.find((entry) => entry.exercise_id === exerciseId)?.exercise_name ?? "Exercise";
                return (
                  <Pressable key={exerciseId} onPress={() => setSelectedExerciseId(exerciseId)} style={[styles.chip, selectedExerciseId === exerciseId && styles.chipActive]}>
                    <Body style={[styles.chipText, selectedExerciseId === exerciseId && styles.chipTextActive]}>{label}</Body>
                  </Pressable>
                );
              })}
              {!availableExerciseIds.length ? <Body>Log an eligible workout or invite friends to start a leaderboard.</Body> : null}
            </View>
          </Panel>

          <Panel>
            <View style={styles.panelHeader}>
              <View>
                <Label>{selectedExercise?.primary_muscle ?? "Exercise PR"}</Label>
                <SectionTitle>{selectedExercise?.name ?? selectedEntries[0]?.exercise_name ?? "Leaderboard"}</SectionTitle>
              </View>
              <Trophy size={22} color={palette.accent} />
            </View>
            {selectedEntries.length ? selectedEntries.map((entry, index) => (
              <LeaderboardRow key={`${entry.user_id}-${entry.exercise_id}`} entry={entry} rank={index + 1} isCurrentUser={String(entry.user_id) === String(currentUser?.id)} />
            )) : (
              <Body>No estimated 1RM results for this exercise yet.</Body>
            )}
          </Panel>
        </>
      ) : null}

      {tab === "friends" ? (
        <>
          <Panel>
            <View style={styles.panelHeader}>
              <View>
                <SectionTitle>Friends</SectionTitle>
                <Body>{acceptedFriends.length ? "Friends appear on leaderboards. Split schedules synchronize only after both people opt in." : "No friends yet."}</Body>
              </View>
              <Users size={22} color={palette.accent} />
            </View>
            {acceptedFriends.length ? acceptedFriends.map((friend) => (
              <View key={friend.id} style={styles.friendRow}>
                <View style={styles.friendDetails}>
                  <Body style={styles.friendName}>{friend.name}</Body>
                  <Body>Friends since {formatShortDate(friend.created_at.slice(0, 10))}</Body>
                  <Body>{splitSyncStatusText(friend.split_sync_status)}</Body>
                  <View style={styles.actionRow}>
                    {friend.split_sync_status === "none" || !friend.split_sync_status ? (
                      <Pressable
                        disabled={socialLoading}
                        onPress={() => void requestSplitSync(friend.id, trainingSplit.days)}
                        style={pressableFeedback(styles.secondaryButton)}
                      >
                        <Body style={styles.secondaryButtonText}>Request split sync</Body>
                      </Pressable>
                    ) : null}
                    {friend.split_sync_status === "received" && friend.split_sync_request_id ? (
                      <>
                        <Pressable
                          disabled={socialLoading}
                          onPress={() => void respondSplitSync(friend.split_sync_request_id!, true)}
                          style={pressableFeedback(styles.secondaryButton)}
                        >
                          <Check size={17} color={palette.ink} />
                          <Body style={styles.secondaryButtonText}>Accept sync</Body>
                        </Pressable>
                        <Pressable
                          disabled={socialLoading}
                          onPress={() => void respondSplitSync(friend.split_sync_request_id!, false)}
                          style={pressableFeedback(styles.secondaryButton)}
                        >
                          <X size={17} color={palette.ink} />
                          <Body style={styles.secondaryButtonText}>Decline</Body>
                        </Pressable>
                      </>
                    ) : null}
                    {friend.split_sync_status === "sent" || friend.split_sync_status === "synced" ? (
                      <Pressable
                        disabled={socialLoading}
                        onPress={() => void removeSplitSync(friend.id)}
                        style={pressableFeedback(styles.secondaryButton)}
                      >
                        <Body style={styles.secondaryButtonText}>{friend.split_sync_status === "synced" ? "Stop syncing" : "Cancel request"}</Body>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                <Pressable
                  accessibilityLabel={`Remove ${friend.name}`}
                  accessibilityRole="button"
                  disabled={socialLoading}
                  onPress={() => void removeFriend(friend.id)}
                  style={pressableFeedback(styles.iconButton)}
                >
                  <Trash2 size={18} color={palette.danger} />
                </Pressable>
              </View>
            )) : <Body>Create an invite to connect on leaderboards, then request split sync from the Friends list when needed.</Body>}
          </Panel>

          <Panel>
            <SectionTitle>Pending</SectionTitle>
            {pendingFriends.length ? pendingFriends.map((friend) => (
              <View key={friend.id} style={styles.friendRow}>
                <View>
                  <Body style={styles.friendName}>{friend.name}</Body>
                  <Body>{friend.direction === "sent" ? "Invite sent" : "Invite received"}</Body>
                </View>
              </View>
            )) : <Body>No pending friend requests.</Body>}
          </Panel>
        </>
      ) : null}

      {tab === "invite" ? (
        <>
          <Panel>
            <View style={styles.panelHeader}>
              <View>
                <SectionTitle>Invite link</SectionTitle>
                <Body>One link connects one friend to private leaderboards. Split sync is requested separately after connecting.</Body>
              </View>
              <UserPlus size={22} color={palette.accent} />
            </View>
            <Pressable onPress={() => void createFriendInvite()} style={pressableFeedback(styles.primaryButton)}>
              <Link size={18} color={palette.surface} />
              <Body style={styles.primaryButtonText}>{socialLoading ? "Creating..." : "Create invite"}</Body>
            </Pressable>
            {inviteValue ? (
              <View style={styles.inviteBox}>
                <Body selectable style={styles.inviteText}>{inviteValue}</Body>
                <View style={styles.actionRow}>
                  <Pressable onPress={() => void copyInvite(inviteValue)} style={pressableFeedback(styles.secondaryButton)}>
                    <Copy size={17} color={palette.ink} />
                    <Body style={styles.secondaryButtonText}>Copy</Body>
                  </Pressable>
                  <Pressable onPress={() => void shareInvite(inviteValue)} style={pressableFeedback(styles.secondaryButton)}>
                    <Share2 size={17} color={palette.ink} />
                    <Body style={styles.secondaryButtonText}>Share</Body>
                  </Pressable>
                </View>
              </View>
            ) : null}
            {copyNotice ? <Body>{copyNotice}</Body> : null}
          </Panel>

          <Panel>
            <SectionTitle>Open invites</SectionTitle>
            {socialData.invites.length ? socialData.invites.map((invite) => (
              <View key={invite.id} style={styles.inviteRow}>
                <View style={styles.inviteDetails}>
                  <Body selectable style={styles.friendName}>{invite.token}</Body>
                  <Body>Expires {formatShortDate(invite.expires_at.slice(0, 10))}</Body>
                </View>
                <Pressable accessibilityRole="button" onPress={() => void revokeFriendInvite(invite.id)} style={pressableFeedback(styles.iconButton)}>
                  <Trash2 size={18} color={palette.danger} />
                </Pressable>
              </View>
            )) : <Body>No open invites.</Body>}
          </Panel>

          <Panel>
            <SectionTitle>Accept code</SectionTitle>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setInviteCode}
              placeholder="Paste invite code"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={inviteCode}
            />
            <Pressable onPress={() => void acceptCode()} style={pressableFeedback(styles.primaryButton)}>
              <UserPlus size={18} color={palette.surface} />
              <Body style={styles.primaryButtonText}>Accept invite</Body>
            </Pressable>
          </Panel>
        </>
      ) : null}
    </Screen>
  );
}

function LeaderboardRow({ entry, rank, isCurrentUser }: { entry: LeaderboardEntry; rank: number; isCurrentUser: boolean }) {
  return (
    <View style={[styles.leaderboardRow, isCurrentUser && styles.leaderboardRowActive]}>
      <View style={styles.rankBadge}>
        <Body style={styles.rankText}>{rank}</Body>
      </View>
      <View style={styles.leaderboardName}>
        <Body style={styles.friendName}>{isCurrentUser ? "You" : entry.name}</Body>
        <Body>{formatShortDate(entry.achieved_at)}</Body>
        {entry.best_sets?.length ? (
          <Body style={styles.setSummary}>
            {entry.best_sets.map((set) => `${formatLeaderboardWeight(set.weight)} lb × ${set.reps}`).join(" · ")}
          </Body>
        ) : null}
      </View>
      <SectionTitle>{Math.round(entry.best_estimated_1rm)} e1RM</SectionTitle>
    </View>
  );
}

function formatLeaderboardWeight(weight: number) {
  return Number(weight.toFixed(1)).toString();
}

function splitSyncStatusText(status: "none" | "sent" | "received" | "synced" | undefined) {
  if (status === "synced") return "Split schedule synchronized.";
  if (status === "sent") return "Split synchronization request sent.";
  if (status === "received") return "Requested to synchronize split schedules.";
  return "Split schedule not synchronized.";
}

const styles = StyleSheet.create({
  segmentRow: {
    flexDirection: "row",
    gap: spacing.sm
  },
  segmentButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm
  },
  segmentButtonActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  segmentText: {
    color: palette.ink,
    fontWeight: "900",
    textAlign: "center"
  },
  segmentTextActive: {
    color: palette.surface
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md
  },
  friendDetails: {
    flex: 1,
    gap: spacing.xs
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  chip: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: palette.surface
  },
  chipActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  chipText: {
    color: palette.ink,
    fontWeight: "800"
  },
  chipTextActive: {
    color: palette.surface
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceAlt,
    borderColor: palette.border,
    borderWidth: 1
  },
  leaderboardRow: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderTopColor: palette.border,
    borderTopWidth: 1,
    paddingTop: spacing.md
  },
  leaderboardRowActive: {
    backgroundColor: palette.accentSoft,
    borderRadius: 8,
    borderTopWidth: 0,
    padding: spacing.sm
  },
  rankBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.ink
  },
  rankText: {
    color: palette.surface,
    fontWeight: "900"
  },
  leaderboardName: {
    flex: 1,
    gap: 2
  },
  setSummary: {
    color: palette.muted,
    fontWeight: "700"
  },
  friendRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderTopColor: palette.border,
    borderTopWidth: 1,
    paddingTop: spacing.md
  },
  friendName: {
    color: palette.ink,
    fontWeight: "900"
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md
  },
  primaryButtonText: {
    color: palette.surface,
    fontWeight: "900"
  },
  secondaryButton: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md
  },
  secondaryButtonText: {
    color: palette.ink,
    fontWeight: "900"
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  inviteBox: {
    gap: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceAlt,
    padding: spacing.md
  },
  inviteText: {
    color: palette.ink,
    fontWeight: "800"
  },
  inviteRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderTopColor: palette.border,
    borderTopWidth: 1,
    paddingTop: spacing.md
  },
  inviteDetails: {
    flex: 1
  },
  input: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    color: palette.ink,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    fontWeight: "800"
  }
});

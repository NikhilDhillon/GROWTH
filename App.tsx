import "react-native-gesture-handler";

import { Analytics } from "@vercel/analytics/react";
import { DefaultTheme, CommonActions, NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { BarChart3, Dumbbell, Home, ListChecks, Menu, Plus, Settings, Users } from "lucide-react-native";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { LogoMark } from "@/components/LogoMark";
import { BottomSheet } from "@/components/BottomSheet";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { pressableFeedback } from "@/utils/touch";
import { useFitnessStore } from "@/store/useFitnessStore";
import { HomeScreen } from "@/screens/Home/HomeScreen";
import { RecordScreen } from "@/screens/Record/RecordScreen";
import { WorkoutScreen } from "@/screens/Workout/WorkoutScreen";
import { ExerciseScreen } from "@/screens/Exercise/ExerciseScreen";
import { BodyweightScreen } from "@/screens/Bodyweight/BodyweightScreen";
import { BodyCheckInScreen } from "@/screens/BodyCheckIn/BodyCheckInScreen";
import { ProgressScreen } from "@/screens/Progress/ProgressScreen";
import { SettingsScreen } from "@/screens/Settings/SettingsScreen";
import { GuidedWorkoutSettingsScreen } from "@/screens/Settings/GuidedWorkoutSettingsScreen";
import { AuthScreen } from "@/screens/Auth/AuthScreen";
import { LogsScreen } from "@/screens/Logs/LogsScreen";
import { SocialScreen } from "@/screens/Social/SocialScreen";
import { FlowWorkoutScreen, GuidedWorkoutScreen } from "@/screens/Workout/GuidedWorkoutScreen";
import { WorkoutSummaryScreen } from "@/screens/Workout/WorkoutSummaryScreen";
import { appLinking, navigationSection, routeTitles } from "@/navigation/appNavigation";
import type { AppRouteName, PrimaryRouteName, RootStackParamList } from "@/navigation/appNavigation";

type CurrentRouteName = AppRouteName;
type NavIcon = ComponentType<{ color: string; size: number }>;
type Destination = { key: string; name: AppRouteName; label: string; Icon: NavIcon; params?: Record<string, unknown> };

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

const appRoutes: Array<{ name: AppRouteName; component: ComponentType }> = [
  { name: "Home", component: HomeScreen },
  { name: "Record", component: RecordScreen },
  { name: "Log", component: WorkoutScreen },
  { name: "Exercises", component: ExerciseScreen },
  { name: "Bodyweight", component: BodyweightScreen },
  { name: "Progress", component: ProgressScreen },
  { name: "Social", component: SocialScreen },
  { name: "Logs", component: LogsScreen },
  { name: "Settings", component: SettingsScreen }
];
const primaryRoutes: Array<Destination & { name: PrimaryRouteName }> = [
  { key: "Home", name: "Home", label: "Home", Icon: Home },
  { key: "Record", name: "Record", label: "Record", Icon: Plus },
  { key: "Progress", name: "Progress", label: "Progress", Icon: BarChart3 },
  { key: "Logs", name: "Logs", label: "History", Icon: ListChecks }
];
const moreRoutes: Destination[] = [
  { key: "Exercises", name: "Exercises", label: "Exercises", Icon: Dumbbell },
  { key: "Social", name: "Social", label: "Social", Icon: Users },
  { key: "Settings", name: "Settings", label: "Settings", Icon: Settings },
];

export default function App() {
  const { palette, styles, colorScheme } = useStyles();
  const { width } = useWindowDimensions();
  const hydrate = useFitnessStore((state) => state.hydrate);
  const loading = useFitnessStore((state) => state.loading);
  const currentUser = useFitnessStore((state) => state.currentUser);
  const dataError = useFitnessStore((state) => state.dataError);
  const dataLoading = useFitnessStore((state) => state.dataLoading);
  const operationNotice = useFitnessStore((state) => state.operationNotice);
  const acceptFriendInvite = useFitnessStore((state) => state.acceptFriendInvite);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(() => isRecoveryUrl());
  const [pendingInviteToken, setPendingInviteToken] = useState(() => getInviteToken());
  const [activeRouteName, setActiveRouteName] = useState<CurrentRouteName>("Home");
  const [moreOpen, setMoreOpen] = useState(false);
  const isLaptopWeb = Platform.OS === "web" && width >= 768;
  // Flow mode is a focus mode: no header, sidebar or tab bar while it is open.
  const focused = activeRouteName === "FlowWorkout";

  function updateActiveRoute() {
    const routeName = navigationRef.getCurrentRoute()?.name;
    if (isAppRouteName(routeName) || routeName === "ActiveWorkout" || routeName === "FlowWorkout" || routeName === "GuidedWorkoutSettings" || routeName === "WorkoutSummary" || routeName === "BodyCheckIn") {
      setActiveRouteName(routeName);
    }
  }

  function navigateApp(destination: Destination) {
    setMoreOpen(false);
    if (navigationRef.isReady() && (destination.name !== activeRouteName || destination.params)) {
      navigationRef.dispatch(CommonActions.navigate({ name: destination.name, params: destination.params }));
    }
  }

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.colorScheme = colorScheme;
    document.documentElement.style.backgroundColor = palette.background;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = palette.background;
  }, [colorScheme, palette]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = isPasswordRecovery ? "Reset Password - GROWTH" : currentUser ? "GROWTH" : "Login - GROWTH";
  }, [currentUser, isPasswordRecovery]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const styleId = "growth-touch-responsiveness";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      html, body, #root {
        touch-action: manipulation;
        -webkit-text-size-adjust: 100%;
      }

      body {
        overscroll-behavior-y: none;
      }

      *, *::before, *::after {
        -webkit-tap-highlight-color: transparent;
      }

      [role="button"], button, input, textarea, select {
        touch-action: manipulation;
      }

      [role="button"], button {
        -webkit-touch-callout: none;
        user-select: none;
      }
    `;
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    if (!currentUser || !pendingInviteToken || isPasswordRecovery) return;
    void acceptFriendInvite(pendingInviteToken).finally(() => {
      setPendingInviteToken(null);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("invite");
        window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
      }
    });
  }, [acceptFriendInvite, currentUser, isPasswordRecovery, pendingInviteToken]);

  if (loading) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.background }}>
          <ActivityIndicator color={palette.ink} />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <Analytics />
      <NavigationContainer theme={{ ...DefaultTheme, dark: colorScheme === "dark", colors: { ...DefaultTheme.colors, primary: palette.accent, background: palette.background, card: palette.surface, text: palette.ink, border: palette.border, notification: palette.danger } }} key={currentUser?.id ?? "guest"} ref={navigationRef} linking={{ ...appLinking, enabled: Boolean(currentUser) && !isPasswordRecovery }} onReady={updateActiveRoute} onStateChange={updateActiveRoute}>
        <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
        {dataError || operationNotice ? (
          <View style={{ backgroundColor: palette.surface, borderBottomWidth: 1, borderColor: palette.border, padding: spacing.md, gap: spacing.sm }}>
            <Text accessibilityRole="alert" style={{ color: palette.ink }}>
              {dataError ? `Could not refresh data. Your saved records are preserved. ${dataError}` : operationNotice}
            </Text>
            {dataError ? (
              <Pressable accessibilityRole="button" disabled={dataLoading} onPress={() => void hydrate()} style={pressableFeedback({ paddingVertical: spacing.sm })}>
                <Text style={{ color: palette.ink, fontWeight: "700" }}>{dataLoading ? "Retrying…" : "Retry loading"}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {isPasswordRecovery ? (
          <AuthScreen
            forcePasswordUpdate
            onPasswordUpdated={() => {
              setIsPasswordRecovery(false);
              if (typeof window !== "undefined") {
                window.history.replaceState({}, document.title, window.location.origin);
              }
            }}
          />
        ) : currentUser ? (
          <View style={[styles.appShell, isLaptopWeb && !focused && styles.appShellWithSidebar]}>
            {isLaptopWeb && !focused ? <AppSidebar activeRouteName={activeRouteName} onNavigate={navigateApp} /> : null}
            <Stack.Navigator
              screenOptions={({ route }) => ({
                header: () =>
                  (
                    <AppHeader
                      currentRouteName={route.name}
                      currentUserName={displayName(currentUser.name, currentUser.email)}
                    />
                  )
              })}
            >
              {appRoutes.map((route) => (
                <Stack.Screen key={route.name} name={route.name} component={route.component} getId={() => route.name} />
              ))}
              <Stack.Screen name="GuidedWorkoutSettings" component={GuidedWorkoutSettingsScreen} getId={() => "GuidedWorkoutSettings"} />
              <Stack.Screen name="BodyCheckIn" component={BodyCheckInScreen} getId={() => "BodyCheckIn"} />
              <Stack.Screen name="ActiveWorkout" component={GuidedWorkoutScreen} getId={() => "ActiveWorkout"} />
              <Stack.Screen name="FlowWorkout" component={FlowWorkoutScreen} getId={() => "FlowWorkout"} options={{ headerShown: false, animation: "fade" }} />
              <Stack.Screen name="WorkoutSummary" component={WorkoutSummaryScreen} getId={({ params }) => params?.workoutId} />
            </Stack.Navigator>
            {!isLaptopWeb && !focused ? <MobileNavigation activeRouteName={activeRouteName} onNavigate={navigateApp} onMore={() => setMoreOpen(true)} /> : null}
            <MoreMenu visible={moreOpen} onClose={() => setMoreOpen(false)} onNavigate={navigateApp} />
          </View>
        ) : (
          <AuthScreen />
        )}
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

function isRecoveryUrl() {
  if (typeof window === "undefined") return false;
  const value = `${window.location.search}&${window.location.hash}`;
  return value.includes("type=recovery");
}

function getInviteToken() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("invite");
}

function displayName(name: string, email: string) {
  return name.trim() || email.split("@")[0] || "User";
}

function isAppRouteName(value: unknown): value is AppRouteName {
  return typeof value === "string" && value in routeTitles;
}

function AppHeader({ currentRouteName, currentUserName }: {
  currentRouteName: CurrentRouteName;
  currentUserName: string;
}) {
  const { palette, styles } = useStyles();
  return (
    <SafeAreaView style={styles.headerSafe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1}>{routeTitles[currentRouteName]}</Text>
        <Avatar name={currentUserName} />
      </View>
    </SafeAreaView>
  );
}

function MobileNavigation({ activeRouteName, onNavigate, onMore }: {
  activeRouteName: CurrentRouteName;
  onNavigate: (destination: Destination) => void;
  onMore: () => void;
}) {
  const { palette, styles } = useStyles();
  const section = navigationSection(activeRouteName);
  return <SafeAreaView style={styles.bottomSafe} edges={["bottom", "left", "right"]}>
    <View style={styles.bottomBar}>
      {primaryRoutes.map((route) => {
        const selected = section === route.name;
        const Icon = route.Icon;
        return <Pressable key={route.key} accessibilityRole="button" accessibilityLabel={route.label} accessibilityState={{ selected }} onPress={() => onNavigate(route)} style={pressableFeedback([styles.bottomItem, selected && styles.bottomItemActive])}><Icon size={22} color={selected ? palette.ink : palette.muted} /><Text style={[styles.bottomLabel, selected && styles.menuItemTextActive]}>{route.label}</Text></Pressable>;
      })}
      <Pressable accessibilityRole="button" accessibilityLabel="More" accessibilityState={{ selected: section === "More" }} onPress={onMore} style={pressableFeedback([styles.bottomItem, section === "More" && styles.bottomItemActive])}><Menu size={22} color={section === "More" ? palette.ink : palette.muted} /><Text style={[styles.bottomLabel, section === "More" && styles.menuItemTextActive]}>More</Text></Pressable>
    </View>
  </SafeAreaView>;
}

function DestinationButton({ destination, selected = false, onNavigate }: { destination: Destination; selected?: boolean; onNavigate: (destination: Destination) => void }) {
  const { palette, styles } = useStyles();
  const Icon = destination.Icon;
  return <Pressable accessibilityRole="button" accessibilityLabel={destination.label} accessibilityState={{ selected }} onPress={() => onNavigate(destination)} style={pressableFeedback([styles.menuItem, selected && styles.menuItemActive])}><Icon size={20} color={selected ? palette.ink : palette.muted} /><Text numberOfLines={1} style={[styles.menuItemText, selected && styles.menuItemTextActive]}>{destination.label}</Text></Pressable>;
}

function MoreMenu({ visible, onClose, onNavigate }: { visible: boolean; onClose: () => void; onNavigate: (destination: Destination) => void }) {
  return <Modal animationType="none" transparent statusBarTranslucent visible={visible} onRequestClose={onClose}>
    <BottomSheet title="More" closeLabel="Close More menu" onClose={onClose}>
      {moreRoutes.map((destination) => <DestinationButton key={destination.key} destination={destination} onNavigate={onNavigate} />)}
    </BottomSheet>
  </Modal>;
}

function AppSidebar({ activeRouteName, onNavigate }: { activeRouteName: CurrentRouteName; onNavigate: (destination: Destination) => void }) {
  const { palette, styles } = useStyles();
  const section = navigationSection(activeRouteName);
  return <SafeAreaView style={styles.sidebarSafe} edges={["top", "left", "bottom"]}>
    <View style={styles.sidebar}>
      <View style={styles.sidebarHeader}><LogoMark size={32} /><Text style={styles.sidebarBrand}>GROWTH</Text></View>
      <ScrollView contentContainerStyle={styles.sidebarList} showsVerticalScrollIndicator={false}>
        {primaryRoutes.map((destination) => <DestinationButton key={destination.key} destination={destination} selected={section === destination.name} onNavigate={onNavigate} />)}
        <Text style={styles.sidebarGroup}>More</Text>
        {moreRoutes.map((destination) => <DestinationButton key={destination.key} destination={destination} selected={destination.name === activeRouteName && !destination.params} onNavigate={onNavigate} />)}
      </ScrollView>
    </View>
  </SafeAreaView>;
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  appShell: {
    flex: 1
  },
  appShellWithSidebar: {
    paddingLeft: 248
  },
  bottomSafe: { backgroundColor: palette.surface, borderTopWidth: 1, borderColor: palette.border },
  bottomBar: { flexDirection: "row", paddingHorizontal: spacing.xs, paddingVertical: spacing.xs, gap: 2 },
  bottomItem: { flex: 1, minWidth: 44, minHeight: 56, borderRadius: 8, alignItems: "center", justifyContent: "center", gap: 4 },
  bottomItemActive: { backgroundColor: palette.accentSoft },
  bottomLabel: { color: palette.muted, fontSize: 11, fontWeight: "800" },
  sidebarGroup: { color: palette.muted, fontSize: 12, fontWeight: "800", padding: spacing.md },
  headerSafe: {
    backgroundColor: palette.surface,
    borderBottomColor: palette.border,
    borderBottomWidth: 1
  },
  header: {
    minHeight: 58,
    maxWidth: 880,
    width: "100%",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  sidebarSafe: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 248,
    zIndex: 10,
    backgroundColor: palette.surface,
    borderRightColor: palette.border,
    borderRightWidth: 1
  },
  sidebar: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.md
  },
  sidebarHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomColor: palette.border,
    borderBottomWidth: 1
  },
  sidebarBrand: {
    color: palette.ink,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 2
  },
  sidebarList: {
    gap: spacing.xs
  },
  headerTitle: {
    flex: 1,
    color: palette.ink,
    fontSize: 19,
    fontWeight: "900"
  },
  menuItem: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    borderColor: "transparent",
    borderWidth: 1
  },
  menuItemActive: {
    backgroundColor: palette.accentSoft,
    borderColor: palette.border
  },
  menuItemText: {
    color: palette.muted,
    fontSize: 16,
    fontWeight: "800"
  },
  menuItemTextActive: {
    color: palette.ink
  }
}));

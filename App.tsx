import "react-native-gesture-handler";

import { Analytics } from "@vercel/analytics/react";
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { BarChart3, Dumbbell, Home, LineChart, ListChecks, Menu, Scale, Settings, TrendingUp, Users, X } from "lucide-react-native";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { palette, spacing } from "@/utils/theme";
import { pressableFeedback, touchHitSlop } from "@/utils/touch";
import { useFitnessStore } from "@/store/useFitnessStore";
import { HomeScreen } from "@/screens/Home/HomeScreen";
import { WorkoutScreen } from "@/screens/Workout/WorkoutScreen";
import { ExerciseScreen } from "@/screens/Exercise/ExerciseScreen";
import { AnalyticsScreen } from "@/screens/Analytics/AnalyticsScreen";
import { SettingsScreen } from "@/screens/Settings/SettingsScreen";
import { AuthScreen } from "@/screens/Auth/AuthScreen";
import { LogsScreen } from "@/screens/Logs/LogsScreen";
import { BodyweightScreen } from "@/screens/Bodyweight/BodyweightScreen";
import { BulkAnalyticsScreen } from "@/screens/BulkAnalytics/BulkAnalyticsScreen";
import { SocialScreen } from "@/screens/Social/SocialScreen";
import { GuidedWorkoutScreen } from "@/screens/Workout/GuidedWorkoutScreen";

type RootStackParamList = {
  Home: undefined;
  Log: undefined;
  Exercises: undefined;
  Progress: undefined;
  Bodyweight: undefined;
  Bulk: undefined;
  Social: undefined;
  Logs: undefined;
  Settings: undefined;
  ActiveWorkout: undefined;
};

type AppRouteName = Exclude<keyof RootStackParamList, "ActiveWorkout">;
type CurrentRouteName = keyof RootStackParamList;
type NavIcon = ComponentType<{ color: string; size: number }>;

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

const appRoutes: Array<{ name: AppRouteName; label: string; component: ComponentType; Icon: NavIcon }> = [
  { name: "Home", label: "Home", component: HomeScreen, Icon: Home },
  { name: "Log", label: "Log", component: WorkoutScreen, Icon: Dumbbell },
  { name: "Exercises", label: "Exercises", component: ExerciseScreen, Icon: LineChart },
  { name: "Progress", label: "Progress", component: AnalyticsScreen, Icon: BarChart3 },
  { name: "Bodyweight", label: "Bodyweight", component: BodyweightScreen, Icon: Scale },
  { name: "Bulk", label: "Bulk", component: BulkAnalyticsScreen, Icon: TrendingUp },
  { name: "Social", label: "Social", component: SocialScreen, Icon: Users },
  { name: "Logs", label: "Logs", component: LogsScreen, Icon: ListChecks },
  { name: "Settings", label: "Settings", component: SettingsScreen, Icon: Settings }
];

export default function App() {
  const { width } = useWindowDimensions();
  const hydrate = useFitnessStore((state) => state.hydrate);
  const loading = useFitnessStore((state) => state.loading);
  const currentUser = useFitnessStore((state) => state.currentUser);
  const acceptFriendInvite = useFitnessStore((state) => state.acceptFriendInvite);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(() => isRecoveryUrl());
  const [pendingInviteToken, setPendingInviteToken] = useState(() => getInviteToken());
  const [activeRouteName, setActiveRouteName] = useState<CurrentRouteName>("Home");
  const isLaptopWeb = Platform.OS === "web" && width >= 768;

  function updateActiveRoute() {
    const routeName = navigationRef.getCurrentRoute()?.name;
    if (isAppRouteName(routeName) || routeName === "ActiveWorkout") {
      setActiveRouteName(routeName);
    }
  }

  function navigateApp(routeName: AppRouteName) {
    if (navigationRef.isReady() && routeName !== activeRouteName) {
      navigationRef.navigate(routeName);
    }
  }

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

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
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
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
      <NavigationContainer ref={navigationRef} onReady={updateActiveRoute} onStateChange={updateActiveRoute}>
        <StatusBar style="dark" />
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
          <View style={[styles.appShell, isLaptopWeb && styles.appShellWithSidebar]}>
            {isLaptopWeb ? (
              <>
                <AppSidebar activeRouteName={activeRouteName} onNavigate={navigateApp} />
                <View style={styles.desktopUserBadge} pointerEvents="none">
                  <Text style={styles.userBadgeText} numberOfLines={1}>{displayName(currentUser.name, currentUser.email)}</Text>
                </View>
              </>
            ) : null}
            <Stack.Navigator
              screenOptions={({ navigation, route }) => ({
                header: () =>
                  isLaptopWeb ? null : (
                    <AppHeader
                      activeRouteName={isAppRouteName(route.name) ? route.name : "Log"}
                      currentUserName={displayName(currentUser.name, currentUser.email)}
                      onNavigate={(routeName) => navigation.navigate(routeName)}
                    />
                  )
              })}
            >
              {appRoutes.map((route) => (
                <Stack.Screen key={route.name} name={route.name} component={route.component} />
              ))}
              <Stack.Screen name="ActiveWorkout" component={GuidedWorkoutScreen} />
            </Stack.Navigator>
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
  const trimmedName = name.trim();
  if (trimmedName) return trimmedName.split(/\s+/)[0];
  return email.split("@")[0] || "User";
}

function isAppRouteName(value: unknown): value is AppRouteName {
  return typeof value === "string" && appRoutes.some((route) => route.name === value);
}

function AppHeader({
  activeRouteName,
  currentUserName,
  onNavigate,
  showMenuButton = true
}: {
  activeRouteName: AppRouteName;
  currentUserName: string;
  onNavigate: (routeName: AppRouteName) => void;
  showMenuButton?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const activeRoute = appRoutes.find((route) => route.name === activeRouteName) ?? appRoutes[0];

  function navigateTo(routeName: AppRouteName) {
    setMenuOpen(false);
    if (routeName !== activeRouteName) {
      onNavigate(routeName);
    }
  }

  return (
    <SafeAreaView style={styles.headerSafe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        {showMenuButton ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open navigation menu"
            hitSlop={touchHitSlop}
            onPress={() => setMenuOpen(true)}
            style={pressableFeedback(styles.iconButton)}
          >
            <Menu size={23} color={palette.ink} />
          </Pressable>
        ) : null}
        <Text style={styles.headerTitle} numberOfLines={1}>{activeRoute.label}</Text>
        <View style={styles.userBadge} pointerEvents="none">
          <Text style={styles.userBadgeText} numberOfLines={1}>{currentUserName}</Text>
        </View>
      </View>

      <Modal animationType="fade" transparent visible={menuOpen} onRequestClose={() => setMenuOpen(false)}>
        <View style={styles.menuLayer}>
          <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)} />
          <SafeAreaView style={styles.menuSafe} edges={["top", "left", "right", "bottom"]}>
            <View style={styles.menuPanel}>
              <View style={styles.menuHeader}>
                <Text style={styles.menuTitle}>Navigate</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close navigation menu"
                  hitSlop={touchHitSlop}
                  onPress={() => setMenuOpen(false)}
                  style={pressableFeedback(styles.iconButton)}
                >
                  <X size={22} color={palette.ink} />
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={styles.menuList} showsVerticalScrollIndicator={false}>
                {appRoutes.map((route) => {
                  const selected = route.name === activeRouteName;
                  const Icon = route.Icon;
                  const color = selected ? palette.ink : palette.muted;

                  return (
                    <Pressable
                      key={route.name}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => navigateTo(route.name)}
                      style={pressableFeedback([styles.menuItem, selected && styles.menuItemActive])}
                    >
                      <Icon size={22} color={color} />
                      <Text style={[styles.menuItemText, selected && styles.menuItemTextActive]}>{route.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function AppSidebar({
  activeRouteName,
  onNavigate
}: {
  activeRouteName: CurrentRouteName;
  onNavigate: (routeName: AppRouteName) => void;
}) {
  return (
    <SafeAreaView style={styles.sidebarSafe} edges={["top", "left", "bottom"]}>
      <View style={styles.sidebar}>
        <View style={styles.sidebarHeader}>
          <Text style={styles.sidebarBrand}>GROWTH</Text>
        </View>

        <ScrollView contentContainerStyle={styles.sidebarList} showsVerticalScrollIndicator={false}>
          {appRoutes.map((route) => {
            const selected = route.name === activeRouteName;
            const Icon = route.Icon;
            const color = selected ? palette.ink : palette.muted;

            return (
              <Pressable
                key={route.name}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  if (route.name !== activeRouteName) onNavigate(route.name);
                }}
                style={pressableFeedback([styles.menuItem, selected && styles.menuItemActive])}
              >
                <Icon size={21} color={color} />
                <Text style={[styles.menuItemText, selected && styles.menuItemTextActive]}>{route.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  appShell: {
    flex: 1
  },
  appShellWithSidebar: {
    paddingLeft: 248
  },
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
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
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
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomColor: palette.border,
    borderBottomWidth: 1
  },
  sidebarBrand: {
    color: palette.ink,
    fontSize: 20,
    fontWeight: "900"
  },
  sidebarList: {
    gap: spacing.xs
  },
  desktopUserBadge: {
    position: "absolute",
    top: spacing.lg,
    right: spacing.xl,
    zIndex: 20,
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    maxWidth: 160
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
  headerTitle: {
    flex: 1,
    color: palette.ink,
    fontSize: 19,
    fontWeight: "900"
  },
  userBadge: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    maxWidth: 128
  },
  userBadgeText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: "900"
  },
  menuLayer: {
    flex: 1
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(23, 32, 28, 0.36)"
  },
  menuSafe: {
    flex: 1,
    justifyContent: "flex-start",
    alignItems: "center",
    padding: spacing.lg
  },
  menuPanel: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "100%",
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden"
  },
  menuHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomColor: palette.border,
    borderBottomWidth: 1
  },
  menuTitle: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "900"
  },
  menuList: {
    padding: spacing.sm,
    gap: spacing.xs
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
});

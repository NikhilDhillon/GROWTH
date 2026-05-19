import "react-native-gesture-handler";

import { Analytics } from "@vercel/analytics/react";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import { BarChart3, Dumbbell, Home, LineChart, ListChecks, Settings } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { palette } from "@/utils/theme";
import { useFitnessStore } from "@/store/useFitnessStore";
import { HomeScreen } from "@/screens/Home/HomeScreen";
import { WorkoutScreen } from "@/screens/Workout/WorkoutScreen";
import { ExerciseScreen } from "@/screens/Exercise/ExerciseScreen";
import { AnalyticsScreen } from "@/screens/Analytics/AnalyticsScreen";
import { SettingsScreen } from "@/screens/Settings/SettingsScreen";
import { AuthScreen } from "@/screens/Auth/AuthScreen";
import { LogsScreen } from "@/screens/Logs/LogsScreen";

const Tab = createBottomTabNavigator();

export default function App() {
  const hydrate = useFitnessStore((state) => state.hydrate);
  const loading = useFitnessStore((state) => state.loading);
  const currentUser = useFitnessStore((state) => state.currentUser);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(() => isRecoveryUrl());

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = isPasswordRecovery ? "Reset Password - GROWTH" : currentUser ? "GROWTH" : "Login - GROWTH";
  }, [currentUser, isPasswordRecovery]);

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
      <NavigationContainer>
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
          <View style={styles.appShell}>
            <View style={styles.userBadge} pointerEvents="none">
              <Text style={styles.userBadgeText}>{displayName(currentUser.name, currentUser.email)}</Text>
            </View>
            <Tab.Navigator
              screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: palette.ink,
                tabBarInactiveTintColor: palette.muted,
                tabBarStyle: {
                  backgroundColor: palette.surface,
                  borderTopColor: palette.border,
                  height: 68,
                  paddingBottom: 10,
                  paddingTop: 8
                },
                tabBarLabelStyle: {
                  fontSize: 11,
                  fontWeight: "700"
                }
              }}
            >
              <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarIcon: ({ color }) => <Home size={21} color={color} /> }} />
              <Tab.Screen name="Log" component={WorkoutScreen} options={{ tabBarIcon: ({ color }) => <Dumbbell size={21} color={color} /> }} />
              <Tab.Screen name="Exercises" component={ExerciseScreen} options={{ tabBarIcon: ({ color }) => <LineChart size={21} color={color} /> }} />
              <Tab.Screen name="Progress" component={AnalyticsScreen} options={{ tabBarIcon: ({ color }) => <BarChart3 size={21} color={color} /> }} />
              <Tab.Screen name="Logs" component={LogsScreen} options={{ tabBarIcon: ({ color }) => <ListChecks size={21} color={color} /> }} />
              <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarIcon: ({ color }) => <Settings size={21} color={color} /> }} />
            </Tab.Navigator>
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

function displayName(name: string, email: string) {
  const trimmedName = name.trim();
  if (trimmedName) return trimmedName.split(/\s+/)[0];
  return email.split("@")[0] || "User";
}

const styles = StyleSheet.create({
  appShell: {
    flex: 1
  },
  userBadge: {
    position: "absolute",
    right: 18,
    top: 12,
    zIndex: 10,
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  userBadgeText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: "900"
  }
});

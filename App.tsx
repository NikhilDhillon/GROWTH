import "react-native-gesture-handler";

import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import { BarChart3, Dumbbell, Home, LineChart, ListChecks, Settings } from "lucide-react-native";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
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

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

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
      <NavigationContainer>
        <StatusBar style="dark" />
        {currentUser ? (
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
        ) : (
          <AuthScreen />
        )}
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

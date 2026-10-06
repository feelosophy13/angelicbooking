import { Stack } from "expo-router";

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerTintColor: "#6d28d9" }}>
      <Stack.Screen name="index" options={{ title: "Today" }} />
      <Stack.Screen name="appointment/[id]" options={{ title: "Appointment" }} />
    </Stack>
  );
}

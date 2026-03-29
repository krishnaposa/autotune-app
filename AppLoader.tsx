import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

type AppModule = { default: React.ComponentType };

/**
 * Loads the real app asynchronously so import-time failures (native modules, etc.)
 * surface as UI instead of a blank/black screen. Metro must be running for dev builds.
 */
export function AppLoader(): React.ReactElement {
  const [AppComponent, setAppComponent] = useState<React.ComponentType | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    import('./App')
      .then((m: AppModule) => {
        if (!cancelled) setAppComponent(() => m.default);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e : new Error(String(e)));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Could not load app JavaScript</Text>
        <Text style={styles.body}>{loadError.message}</Text>
        <Text style={styles.hint}>
          Dev client: run `npx expo start`, then `npm run adb-reverse` (emulator needs port 8081 forwarded to
          your PC). Rebuild after native changes: `npx expo run:android`.
        </Text>
      </View>
    );
  }

  if (!AppComponent) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#38bdf8" />
        <Text style={styles.loading}>Loading app…</Text>
        <Text style={styles.hint}>
          If this never finishes, Metro is not reachable. Start `npx expo start` and run `npm run adb-reverse`.
        </Text>
      </View>
    );
  }

  return <AppComponent />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 14,
  },
  title: { color: '#fecaca', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  body: { color: '#f8fafc', fontSize: 14, textAlign: 'center' },
  loading: { color: '#e2e8f0', fontSize: 16, fontWeight: '600', marginTop: 8 },
  hint: { color: '#94a3b8', fontSize: 13, textAlign: 'center', lineHeight: 19, marginTop: 8 },
});

import * as SplashScreen from 'expo-splash-screen';
import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

type Props = { children: ReactNode };

type State = { error: Error | null };

/**
 * Surfaces JS/render failures instead of a blank or stuck splash (especially on Android).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Root error:', error, info.componentStack);
    void SplashScreen.hideAsync();
  }

  render(): ReactNode {
    if (this.state.error) {
      const msg = this.state.error.message ?? String(this.state.error);
      const stack = this.state.error.stack ?? '';
      return (
        <View style={styles.box}>
          <Text style={styles.title}>App failed to render</Text>
          <Text style={styles.hint}>
            Development: start Metro (`npx expo start`), then from the project folder run `npm run adb-reverse` so the
            emulator can load the bundle from your PC.
          </Text>
          <ScrollView style={styles.scroll}>
            <Text style={styles.err}>{msg}</Text>
            <Text style={styles.stack}>{stack}</Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    padding: 24,
    paddingTop: 56,
    backgroundColor: '#0f172a',
    gap: 12,
  },
  title: { color: '#fecaca', fontSize: 18, fontWeight: '700' },
  hint: { color: '#94a3b8', fontSize: 13, lineHeight: 18 },
  scroll: { flex: 1 },
  err: { color: '#f8fafc', fontSize: 14, fontFamily: 'monospace' },
  stack: { color: '#64748b', fontSize: 11, marginTop: 12, fontFamily: 'monospace' },
});

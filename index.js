/**
 * Root entry — explicit path so Metro never confuses `App` with an `app/` route folder
 * (Windows resolves paths case-insensitively; expo/AppEntry uses `../../App`).
 */
import 'react-native-gesture-handler';
import 'react-native-reanimated';
import 'react-native-worklets';

import registerRootComponent from 'expo/src/launch/registerRootComponent';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect } from 'react';
import { AppLoader } from './AppLoader.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';

function Root() {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <ErrorBoundary>
      <AppLoader />
    </ErrorBoundary>
  );
}

registerRootComponent(Root);

// app/context/AmplitudeContext.tsx
'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as amplitude from '@amplitude/analytics-browser';
import { useAuth, useUser } from '@clerk/nextjs';
import { LogLevel } from '@amplitude/analytics-types';

interface AmplitudeContextType {
  isInitialized: boolean;
  trackAmplitudeEvent: (eventName: string, eventProperties?: Record<string, any>) => void;
  identifyUser: (userId: string, userProperties?: Record<string, any>) => void;
}

const AmplitudeContext = createContext<AmplitudeContextType | undefined>(undefined);

interface AmplitudeProviderProps {
  children: React.ReactNode;
  apiKey?: string;
}

export function AmplitudeProvider({ children, apiKey }: AmplitudeProviderProps) {
  const [isInitialized, setIsInitialized] = useState(false);
  const { userId } = useAuth();
  const { user } = useUser();
  const AMPLITUDE_API_KEY = apiKey || process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY;

  useEffect(() => {
    if (!AMPLITUDE_API_KEY) {
      console.warn('Amplitude API key is not set');
      return;
    }

    try {
      amplitude.init(AMPLITUDE_API_KEY, undefined, {
        defaultTracking: {
          pageViews: true,
          sessions: true,
          formInteractions: true,
        },
        userId: userId || undefined,
        logLevel: (process.env.NODE_ENV === 'development' ? LogLevel.Debug : LogLevel.Error) as LogLevel
      });
      setIsInitialized(true);
      console.log('Amplitude initialized with user:', userId);
    } catch (error) {
      console.error('Failed to initialize Amplitude:', error);
    }
  }, [AMPLITUDE_API_KEY, userId]);

  // This effect runs whenever the user state changes
  useEffect(() => {
    if (isInitialized && userId && user) {
      try {
        // Log initial user data
        console.log('Attempting to identify user in Amplitude:', {
          clerk_user_id: userId,
          user_email: user.primaryEmailAddress?.emailAddress,
          user_name: user.fullName
        });

        amplitude.setUserId(userId);
        
        const identify = new amplitude.Identify();
        identify.set('clerk_user_id', userId);
        identify.set('distinct_id', userId);
        
        if (user.primaryEmailAddress?.emailAddress) {
          identify.set('email', user.primaryEmailAddress.emailAddress);
        }
        if (user.fullName) {
          identify.set('name', user.fullName);
        }
        
        // Log the identify call
        console.log('Amplitude identify payload:', {
          userId,
          identifyProperties: identify.getUserProperties()
        });

        amplitude.identify(identify);
      } catch (error) {
        console.error('Error identifying user in Amplitude:', error);
      }
    }
  }, [isInitialized, userId, user]);

  const identifyUser = useCallback((userId: string, userProperties?: Record<string, any>) => {
    if (!isInitialized) return;
    
    try {
      amplitude.setUserId(userId);
      if (userProperties) {
        const identify = new amplitude.Identify();
        Object.entries(userProperties).forEach(([key, value]) => {
          identify.set(key, value);
        });  
        amplitude.identify(identify, { user_id: userId });
      } 
    } catch (error) {
      console.error('Failed to identify user:', error);
    } 
  }, [isInitialized]);

  const trackAmplitudeEvent = useCallback((eventName: string, eventProperties?: Record<string, any>) => {
    if (!isInitialized || !userId) return;

    try {
      const eventData = {
        ...eventProperties,
        clerk_user_id: userId,
        distinct_id: userId,
        user_email: user?.primaryEmailAddress?.emailAddress,
        timestamp: new Date().toISOString()
      };

      // Log the event data being sent
      console.log('Sending Amplitude event:', {
        eventName,
        eventData
      });

      amplitude.track(eventName, eventData);
    } catch (error) {
      console.error('Failed to track event:', error);
    }
  }, [isInitialized, userId, user]);

  return (
    <AmplitudeContext.Provider value={{ isInitialized, trackAmplitudeEvent, identifyUser }}>
      {children}
    </AmplitudeContext.Provider>
  );
}

export function useAmplitudeContext() {
  const context = useContext(AmplitudeContext);
  if (context === undefined) {
    throw new Error('useAmplitudeContext must be used within an AmplitudeProvider');
  }
  return context;
}

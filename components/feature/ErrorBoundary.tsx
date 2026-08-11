/**
 * ErrorBoundary.tsx
 *
 * Global React error boundary for PredictXta.
 * Catches rendering errors and shows a graceful fallback UI instead of crashing.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <YourComponent />
 *   </ErrorBoundary>
 *
 *   // With custom fallback:
 *   <ErrorBoundary fallback={<MyErrorUI />}>
 *     <YourComponent />
 *   </ErrorBoundary>
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FONTS, RADIUS, SPACING } from '@/constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Optional context label shown in the error report */
  context?: string;
  /** Called when an error is caught */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

// ─── Error Boundary Class ─────────────────────────────────────────────────────
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, showDetails: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ errorInfo: info });

    // Non-blocking error reporting
    try {
      this.props.onError?.(error, info);
      if (__DEV__) {
        console.error('[ErrorBoundary]', this.props.context ?? 'Component', error, info.componentStack);
      }
    } catch { /* never throw inside error handler */ }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, showDetails: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    // Custom fallback
    if (this.props.fallback) return this.props.fallback;

    const { error, showDetails, errorInfo } = this.state;
    const context = this.props.context ?? 'Component';

    return (
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* Icon */}
        <View style={styles.iconWrap}>
          <Ionicons name="warning-outline" size={40} color="#EF4444" />
        </View>

        {/* Title */}
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.context}>in {context}</Text>
        <Text style={styles.message}>
          {error?.message ?? 'An unexpected error occurred. Please try again.'}
        </Text>

        {/* Retry button */}
        <Pressable
          style={({ pressed }) => [styles.retryBtn, pressed ? { opacity: 0.82 } : null]}
          onPress={this.handleRetry}
        >
          <Ionicons name="refresh-outline" size={16} color="#fff" />
          <Text style={styles.retryBtnText}>Try Again</Text>
        </Pressable>

        {/* Dev details toggle */}
        {__DEV__ && errorInfo ? (
          <>
            <Pressable
              style={styles.detailsToggle}
              onPress={() => this.setState((s) => ({ showDetails: !s.showDetails }))}
            >
              <Ionicons name={showDetails ? 'chevron-up' : 'chevron-down'} size={13} color="#6B7280" />
              <Text style={styles.detailsToggleText}>
                {showDetails ? 'Hide' : 'Show'} stack trace
              </Text>
            </Pressable>
            {showDetails ? (
              <ScrollView
                style={styles.stackBox}
                contentContainerStyle={{ padding: 12 }}
                horizontal={false}
              >
                <Text style={styles.stackText}>
                  {error?.stack ?? ''}
                  {'\n\n--- Component Stack ---\n'}
                  {errorInfo.componentStack}
                </Text>
              </ScrollView>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    );
  }
}

// ─── Lightweight HOC wrapper ──────────────────────────────────────────────────
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  context?: string,
): React.FC<P> {
  const Wrapped: React.FC<P> = (props) => (
    <ErrorBoundary context={context ?? Component.displayName ?? Component.name}>
      <Component {...props} />
    </ErrorBoundary>
  );
  Wrapped.displayName = `withErrorBoundary(${Component.displayName ?? Component.name})`;
  return Wrapped;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: 40,
    gap: 10,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: FONTS.extraBold,
    color: '#111827',
    textAlign: 'center',
  },
  context: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: -4,
  },
  message: {
    fontSize: 14,
    color: '#374151',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 300,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#3B82F6',
    borderRadius: RADIUS.full,
    paddingVertical: 12,
    paddingHorizontal: 28,
    marginTop: 8,
  },
  retryBtnText: {
    fontSize: 14,
    fontWeight: FONTS.bold,
    color: '#fff',
  },
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
  },
  detailsToggleText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: FONTS.medium,
  },
  stackBox: {
    maxHeight: 200,
    width: '100%',
    backgroundColor: '#1F2937',
    borderRadius: RADIUS.md,
    marginTop: 4,
  },
  stackText: {
    fontSize: 10,
    color: '#D1FAE5',
    lineHeight: 16,
  },
});

export default ErrorBoundary;

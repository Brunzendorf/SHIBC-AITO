'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Typography, Button, Paper, Alert, Collapse } from '@mui/material';
import { Refresh as RefreshIcon, ExpandMore as ExpandMoreIcon } from '@mui/icons-material';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

/**
 * Error Boundary Component
 * TASK-027: Prevents single component errors from crashing the entire page
 *
 * Usage:
 * <ErrorBoundary>
 *   <ComponentThatMightFail />
 * </ErrorBoundary>
 *
 * With custom fallback:
 * <ErrorBoundary fallback={<CustomErrorUI />}>
 *   <ComponentThatMightFail />
 * </ErrorBoundary>
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    // Call optional error handler
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
  };

  toggleDetails = (): void => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <Paper
          elevation={0}
          sx={{
            p: 3,
            m: 2,
            bgcolor: 'error.dark',
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'error.main',
          }}
        >
          <Alert
            severity="error"
            sx={{ mb: 2, bgcolor: 'transparent' }}
            action={
              <Button
                color="inherit"
                size="small"
                onClick={this.handleRetry}
                startIcon={<RefreshIcon />}
              >
                Retry
              </Button>
            }
          >
            <Typography variant="h6" component="div" gutterBottom>
              Something went wrong
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.9 }}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </Typography>
          </Alert>

          {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
            <Box>
              <Button
                size="small"
                onClick={this.toggleDetails}
                endIcon={
                  <ExpandMoreIcon
                    sx={{
                      transform: this.state.showDetails ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s',
                    }}
                  />
                }
                sx={{ color: 'error.contrastText', opacity: 0.7 }}
              >
                {this.state.showDetails ? 'Hide' : 'Show'} Details
              </Button>
              <Collapse in={this.state.showDetails}>
                <Paper
                  sx={{
                    mt: 2,
                    p: 2,
                    bgcolor: 'grey.900',
                    overflow: 'auto',
                    maxHeight: 300,
                  }}
                >
                  <Typography
                    variant="caption"
                    component="pre"
                    sx={{
                      fontFamily: 'monospace',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      color: 'error.light',
                    }}
                  >
                    {this.state.error?.stack}
                    {'\n\nComponent Stack:'}
                    {this.state.errorInfo.componentStack}
                  </Typography>
                </Paper>
              </Collapse>
            </Box>
          )}
        </Paper>
      );
    }

    return this.props.children;
  }
}

/**
 * Higher-order component to wrap any component with error boundary
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  fallback?: ReactNode
): React.FC<P> {
  const displayName = WrappedComponent.displayName || WrappedComponent.name || 'Component';

  const ComponentWithErrorBoundary: React.FC<P> = (props) => (
    <ErrorBoundary fallback={fallback}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );

  ComponentWithErrorBoundary.displayName = `withErrorBoundary(${displayName})`;

  return ComponentWithErrorBoundary;
}

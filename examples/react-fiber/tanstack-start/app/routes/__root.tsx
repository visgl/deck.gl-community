import {Outlet, createRootRoute} from '@tanstack/react-router';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {TanStackRouterDevtools} from '@tanstack/router-devtools';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/globals.css';

// Create QueryClient
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000 // 5 minutes
    }
  }
});

export const Route = createRootRoute({
  component: RootComponent
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Airports Example - TanStack Start</title>
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <Outlet />
          <TanStackRouterDevtools position="bottom-right" />
        </QueryClientProvider>
      </body>
    </html>
  );
}

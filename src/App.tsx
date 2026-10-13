import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { WalletProvider } from "@/hooks/useWallet";
import { ThemeProvider } from "next-themes";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useNewMessageNotification } from "@/hooks/useNewMessageNotification";
import { useTradeDeadlineReminders } from "@/hooks/useTradeDeadlineReminders";
import { NotificationsProvider, useNotifications } from "@/hooks/useNotifications";
import { PhoneFirst } from "@/components/PhoneFirst";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Profile from "./pages/Profile";
import Admin from "./pages/Admin";
import AdminDisputeDetail from "./pages/AdminDisputeDetail";
import Alerts from "./pages/Alerts";
import WalletCheck from "./pages/WalletCheck";

const queryClient = new QueryClient();

// Component to initialize WebSocket connection and new-message notifications
function OnlineStatusProvider({ children }: { children: React.ReactNode }) {
  useOnlineStatus(); // Initialize WebSocket connection
  useNewMessageNotification(); // Toast + invalidate when user receives a message
  return <>{children}</>;
}

// The server sends deadline reminders when its notification feed is on; otherwise the browser does it here.
function DeadlineFallback() {
  const { feed } = useNotifications();
  useTradeDeadlineReminders(feed === "off");
  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="kadena-nexus-theme">
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <WalletProvider>
            <OnlineStatusProvider>
              <NotificationsProvider>
              <DeadlineFallback />
              <Routes>
                <Route path="/" element={<PhoneFirst><Index /></PhoneFirst>} />
                <Route path="/u/:wallet" element={<Profile />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/wallet-check" element={<WalletCheck />} />
                <Route path="/admin/disputes/:offerId" element={<AdminDisputeDetail />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
              </NotificationsProvider>
            </OnlineStatusProvider>
          </WalletProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;

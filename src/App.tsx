import { AuthProvider } from './lib/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { ItemsPage } from './pages/ItemsPage'

function App() {
  return (
    <AuthProvider>
      <ProtectedRoute>
        <ItemsPage />
      </ProtectedRoute>
    </AuthProvider>
  )
}

export default App

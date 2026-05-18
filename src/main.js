import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'

function userVisibleErrorMessage(err) {
  if (err instanceof Error) return err.message || String(err)
  return typeof err === 'string' ? err : String(err)
}

const app = createApp(App)

app.config.errorHandler = (err) => {
  console.error(err)
  alert(`Something went wrong:\n\n${userVisibleErrorMessage(err)}`)
}

window.addEventListener('unhandledrejection', (event) => {
  console.error(event.reason)
  alert(`Something went wrong:\n\n${userVisibleErrorMessage(event.reason)}`)
})

app.mount('#app')

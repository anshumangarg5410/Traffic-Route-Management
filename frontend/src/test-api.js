import { checkBackendHealth } from "./services/api";

checkBackendHealth()
  .then((data) => console.log("Backend connected:", data))
  .catch((error) => console.error("Backend error:", error));
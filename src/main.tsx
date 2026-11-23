import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "./ui/tokens.css";
import "./styles.css";
import App from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("عنصر الجذر غير موجود");

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

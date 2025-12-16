import { Providers } from "./providers";
import { RouterProviderWithAuth } from "./router-provider";

import "./antd-overrides.css";
import "./zindex.css";
import "./index.css";

export function App() {
  return (
    <Providers>
      <RouterProviderWithAuth />
    </Providers>
  );
}

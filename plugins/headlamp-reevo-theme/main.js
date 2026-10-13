(function (global, factory) {
  if (typeof exports === "object" && typeof module !== "undefined") {
    factory(require("react/jsx-runtime"), require("@kinvolk/headlamp-plugin/lib"));
  } else if (typeof define === "function" && define.amd) {
    define(["react/jsx-runtime", "@kinvolk/headlamp-plugin/lib"], factory);
  } else {
    factory(global.pluginLib.ReactJSX, global.pluginLib);
  }
})(this, function (jsx, pluginLib) {
  "use strict";

  // -------------------------------
  // Theme Registration
  // -------------------------------
  pluginLib.registerAppTheme({
    name: "ReeVo Dark",
    base: "dark",
    primary: "#00B1FF",
    secondary: "#FFFFFF",
    background: {
      default: "#121212",
      surface: "#1E1E1E",
      muted: "#2a2a2a",
    },
    navbar: {
      background: "#000000",
      color: "#FFFFFF",
    },
    sidebar: {
      background: "#000000",
      color: "#FFFFFF",
      selectedBackground: "#00B1FF",
      selectedColor: "#FFFFFF",
    },
    text: {
      primary: "#FFFFFF",
    },
  });

  localStorage.setItem("headlampThemePreference", "ReeVo Dark");

  // -------------------------------
  // Logo Components
  // -------------------------------
  const FullLogo = () =>
    jsx.jsxs("svg", {
      viewBox: "0 0 150 50",
      height: "32",
      xmlns: "http://www.w3.org/2000/svg",
      style: { background: "transparent" },
      children: [
        jsx.jsx("text", {
          x: "0",
          y: "28",
          fontSize: "28",
          fill: "#00B1FF",
          fontWeight: "bold",
          fontFamily: "Arial",
          children: "ReeVo",
        }),
        jsx.jsx("text", {
          x: "0",
          y: "45",
          fontSize: "10",
          fill: "#AAAAAA",
          fontFamily: "Arial",
          children: "Powered by Headlamp",
        }),
      ],
    });

  const SmallLogo = () =>
    jsx.jsx("svg", {
      viewBox: "0 0 50 50",
      height: "32",
      xmlns: "http://www.w3.org/2000/svg",
      style: { background: "transparent" },
      children: jsx.jsx("text", {
        x: "0",
        y: "35",
        fontSize: "28",
        fill: "#00B1FF",
        fontWeight: "bold",
        fontFamily: "Arial",
        children: "R",
      }),
    });

  // Headlamp picks the active theme when it creates its store, from localStorage, before
  // the plugins load: the preference set above applies only from the next page load. The
  // logo renders on every page, so its first render also switches the running app to the
  // theme. Once per page load, so a theme chosen in Settings afterwards is kept.
  let themeApplied = false;

  function useApplyTheme() {
    const dispatch = pluginLib.ReactRedux.useDispatch();
    pluginLib.React.useEffect(() => {
      if (themeApplied) return;
      themeApplied = true;
      dispatch({ type: "theme/setTheme", payload: "ReeVo Dark" });
    }, [dispatch]);
  }

  function AppLogo({ logoType }) {
    useApplyTheme();
    return logoType === "small" ? jsx.jsx(SmallLogo, {}) : jsx.jsx(FullLogo, {});
  }

  pluginLib.registerAppLogo(AppLogo);

  console.log("ReeVo Theme Plugin Loaded");
});

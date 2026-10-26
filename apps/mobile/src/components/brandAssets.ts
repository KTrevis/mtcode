import Constants from "expo-constants";

const appVariant = Constants.expoConfig?.extra?.appVariant;

import { getBrandMark } from "../lib/branding";

export const T3_CODE_BRAND_MARK_SOURCE =
  getBrandMark() !== "T3"
    ? require("../../../../assets/munim/munim-icon-dark-1024.png")
    : appVariant === "development"
      ? require("../../../../assets/dev/blueprint-ios-1024.png")
      : appVariant === "preview"
        ? require("../../../../assets/nightly/nightly-ios-1024.png")
        : require("../../../../assets/prod/black-ios-1024.png");

/* weatherService — the weather seam (brief §24). Today it returns the
   server's demo weather card; a live weather API can replace the
   implementation later without changing the stylist UI. */

import { api, type ApiResponse } from "../api";

export type WeatherReading = ApiResponse<typeof api, "getWeatherOutfit">["weather"];
export type WeatherOutfitResult = ApiResponse<typeof api, "getWeatherOutfit">;

export const weatherService = {
  async getWeatherOutfit(userId: number, seed = 0): Promise<WeatherOutfitResult> {
    return api.getWeatherOutfit({ userId, seed });
  },
};

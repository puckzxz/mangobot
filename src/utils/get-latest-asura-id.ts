import { SeriesSource } from "@prisma/client";
import { dispatchToSidecar } from "../dispatcher";

const getLatestAsuraId = async () => {
  const response = await dispatchToSidecar<string>({
    type: "checkId",
    data: {
      source: SeriesSource.AsuraScans,
    },
  });
  return response;
};

export default getLatestAsuraId;

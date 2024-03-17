const extractAsuraId = (url: string) => {
  return url.split("manga/")[1].split("-")[0];
};

export default extractAsuraId;
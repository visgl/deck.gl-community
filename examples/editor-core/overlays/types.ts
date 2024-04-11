type Point = {lon: number; lat: number};
export type WikipediaEntry = {
  thumbnail: {
    source: string;
  };
  pageid: string;
  coordinates: Point[];
};

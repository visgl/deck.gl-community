import {fetch} from 'global';

// cdn path prefix for s3 uber-static buckets
const PREFIX = 'https://d1a3f4spazzrp4.cloudfront.net/mlvis/graphgl';

/**
 * a utility function that loads a list of files from S3, asynchronously
 *
 * example usage:
 *   fetchJSONFromS3([
 *     'graph.json',
 *     'speeds.json',
 *   ]).then(([graph, speed]) => {
 *      // use the loaded data here
 *   });
 *
 * @param {array} paths: a list file paths on S3
 * @return an array of promises with data loaded from the specified paths
 */
export const fetchJSONFromS3 = async paths =>
  await Promise.all(
    paths.map(async path => {
      const response = await fetch(`${PREFIX}/${path}`);
      return await response.json();
    })
  );

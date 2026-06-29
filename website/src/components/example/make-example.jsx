import React, {useState, useEffect, useCallback} from 'react';
import InfoPanel from '../info-panel';
import {loadData, joinPath} from '../../utils/data-utils';
import {normalizeParam} from '../../utils/format-utils';
import {MAPBOX_STYLES} from '../../constants/defaults';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './make-example.module.css';

export default function makeExample(DemoComponent, {addInfoPanel = true, style} = {}) {
  const {parameters = {}, mapStyle} = DemoComponent;
  const defaultParams = Object.keys(parameters).reduce((acc, name) => {
    acc[name] = normalizeParam(parameters[name]);
    return acc;
  }, {});

  const defaultData = Array.isArray(DemoComponent.data) ? DemoComponent.data.map(_ => null) : null;

  return function ExampleWrapper(wrapperProps = {}) {
    const [data, setData] = useState(defaultData);
    const [params, setParams] = useState(defaultParams);
    const [meta, setMeta] = useState({});
    const baseUrl = useBaseUrl('/');
    const {mapStyle: mapStyleOverride, ...forwardedProps} = wrapperProps;

    const useParam = useCallback(newParameters => {
      const newParams = Object.keys(newParameters).reduce((acc, name) => {
        acc[name] = normalizeParam(newParameters[name]);
        return acc;
      }, {});
      setParams(p => ({...p, ...newParams}));
    }, []);

    const updateMeta = useCallback(newMeta => {
      setMeta(m => ({...m, ...newMeta}));
    }, []);

    useEffect(() => {
      let source = DemoComponent.data;
      if (!source) {
        return;
      }

      const isArray = Array.isArray(source);

      if (!isArray) {
        source = [source];
      }

      for (let index = 0; index < source.length; index++) {
        const {url, worker} = source[index];
        loadData(
          joinPath(baseUrl, url),
          worker && joinPath(baseUrl, worker),
          (resultData, resultMeta) => {
            if (isArray) {
              setData(d => {
                const newData = d.slice();
                newData[index] = resultData;
                return newData;
              });
            } else {
              setData(resultData);
            }
            if (resultMeta) {
              setMeta(m => ({...m, ...resultMeta}));
            }
          }
        );
      }
    }, []);

    const updateParam = (name, value) => {
      const p = params[name];
      if (p) {
        setParams({
          ...params,
          [name]: normalizeParam({...p, value})
        });
      }
    };

    return (
      <div className={styles.demoContainer} style={style}>
        <DemoComponent
          {...forwardedProps}
          data={data}
          mapStyle={mapStyleOverride || mapStyle || MAPBOX_STYLES.BLANK}
          params={params}
          useParam={useParam}
          onStateChange={updateMeta}
        />
        {addInfoPanel && (
          <InfoPanel
            title={DemoComponent.title}
            params={params}
            meta={meta}
            updateParam={updateParam}
            sourceLink={DemoComponent.code}
          >
            {DemoComponent.renderInfo(meta)}
          </InfoPanel>
        )}

        {addInfoPanel && mapStyle && <div className={styles.mapTip}>Hold down shift to rotate</div>}
      </div>
    );
  };
}

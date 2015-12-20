import {Model} from './Model';
import {X, Y, COLOR, TEXT, SIZE, SHAPE, DETAIL, ROW, COLUMN, LABEL} from '../channel';
import {AREA, LINE, TEXT as TEXTMARKS} from '../mark';
import {imputeTransform, stackTransform} from './stack';
import {QUANTITATIVE} from '../type';
import {extend} from '../util';

/* mapping from vega-lite's mark types to vega's mark types */
const MARKTYPES_MAP = {
  bar: 'rect',
  tick: 'rect',
  point: 'symbol',
  line: 'line',
  area: 'area',
  text: 'text',
  circle: 'symbol',
  square: 'symbol'
};

declare var exports;

export function compileMarks(model: Model): any[] {
  const mark = model.mark();
  const name = model.spec().name;
  const isFaceted = model.has(ROW) || model.has(COLUMN);
  const dataFrom = {data: model.dataTable()};

  if (mark === LINE || mark === AREA) {
    const details = detailFields(model);

    // For line and area, we sort values based on dimension by default
    // For line, a special config "sortLineBy" is allowed
    let sortBy = mark === LINE ? model.config('sortLineBy') : undefined;
    if (!sortBy) {
      sortBy = '-' + model.field(model.config('marks', 'orient') === 'horizontal' ? Y : X);
    }

    let pathMarks: any = extend(
      name ? { name: name + '-marks' } : {},
      {
        type: MARKTYPES_MAP[mark],
        from: extend(
          // If has facet, `from.data` will be added in the cell group.
          // If has subfacet for line/area group, `from.data` will be added in the outer subfacet group below.
          // If has no subfacet, add from.data.
          isFaceted || details.length > 0 ? {} : dataFrom,

          // sort transform
          {transform: [{ type: 'sort', by: sortBy }]}
        ),
        properties: { update: exports[mark].properties(model) }
      }
    );

    // FIXME is there a case where area requires impute without stacking?

    if (details.length > 0) { // have level of details - need to facet line into subgroups
      const facetTransform = { type: 'facet', groupby: details };
      const transform = mark === AREA && model.stack() ?
        // For stacked area, we need to impute missing tuples and stack values
        [imputeTransform(model), stackTransform(model), facetTransform] :
        [facetTransform];

      return [{
        name: (name ? name + '-' : '') + mark + '-facet',
        type: 'group',
        from: extend(
          // If has facet, `from.data` will be added in the cell group.
          // Otherwise, add it here.
          isFaceted ? {} : dataFrom,
          {transform: transform}
        ),
        properties: {
          update: {
            width: { field: { group: 'width' } },
            height: { field: { group: 'height' } }
          }
        },
        marks: [pathMarks]
      }];
    } else {
      return [pathMarks];
    }
  } else { // other mark type
    let marks = []; // TODO: vgMarks
    if (mark === TEXTMARKS && model.has(COLOR)) {
      // add background to 'text' marks if has color
      marks.push(extend(
        name ? { name: name + '-background' } : {},
        {type: 'rect'},
        // If has facet, `from.data` will be added in the cell group.
        // Otherwise, add it here.
        isFaceted ? {} : {from: dataFrom},
        // Properties
        {properties: { update: text.background(model) } }
      ));
    }

    marks.push(extend(
      name ? { name: name + '-marks' } : {},
      { type: MARKTYPES_MAP[mark] },
      // Add `from` if needed
      (!isFaceted || model.stack()) ? {
        from: extend(
          // If faceted, `from.data` will be added in the cell group.
          // Otherwise, add it here
          isFaceted ? {} : dataFrom,
          // Stacked Chart need additional transform
          model.stack() ? {transform: [stackTransform(model)]} : {}
        )
      } : {},
      // properties groups
      { properties: { update: exports[mark].properties(model) } }
    ));

    if (model.has(LABEL)) {
      const labelProperties = exports[mark].labels(model);

      // check if we have label method for current mark type.
      // TODO(#240): remove this line once we support label for all mark types
      if (labelProperties) {
        // add label group
        marks.push(extend(
          name ? { name: name + '-label' } : {},
          {type: 'text'},
          // If has facet, `from.data` will be added in the cell group.
          // Otherwise, add it here.
          isFaceted ? {} : {from: dataFrom},
          // Properties
          { properties: { update: labelProperties } }
        ));
      }
    }

    return marks;
  }
}

function colorMixins(model: Model) {
  let p: any = {};
  if (model.config('marks', 'filled')) {
    if (model.has(COLOR)) {
      p.fill = {
        scale: model.scale(COLOR),
        field: model.field(COLOR)
      };
    } else {
      p.fill = { value: model.fieldDef(COLOR).value };
    }
  } else {
    if (model.has(COLOR)) {
      p.stroke = {
        scale: model.scale(COLOR),
        field: model.field(COLOR)
      };
    } else {
      p.stroke = { value: model.fieldDef(COLOR).value };
    }
    p.strokeWidth = { value: model.config('marks').strokeWidth };
  }
  return p;
}

function applyMarksConfig(marksProperties, marksConfig, propsList) {
  propsList.forEach(function(property) {
    const value = marksConfig[property];
    if (value !== undefined) {
      marksProperties[property] = { value: value };
    }
  });
}

/**
 * Returns list of detail fields (for 'color', 'shape', or 'detail' channels)
 * that the model's spec contains.
 */
function detailFields(model: Model): string[] {
  return [COLOR, DETAIL, SHAPE].reduce(function(details, channel) {
    if (model.has(channel) && !model.fieldDef(channel).aggregate) {
      details.push(model.field(channel));
    }
    return details;
  }, []);
}

export namespace bar {
  export function properties(model: Model) {
    const stack = model.stack();

    // FIXME(#724) apply orient from config if applicable
    // TODO Use Vega's marks properties interface
    var p: any = {};

    // x's and width
    if (stack && X === stack.fieldChannel) {
      p.x = {
        scale: model.scale(X),
        field: model.field(X) + '_start'
      };
      p.x2 = {
        scale: model.scale(X),
        field: model.field(X) + '_end'
      };
    } else if (model.fieldDef(X).bin) {
      p.x = {
        scale: model.scale(X),
        field: model.field(X, { binSuffix: '_start' }),
        offset: 1
      };
      p.x2 = {
        scale: model.scale(X),
        field: model.field(X, { binSuffix: '_end' })
      };
    } else if (model.isMeasure(X)) {
      p.x = {
        scale: model.scale(X),
        field: model.field(X)
      };
      if (!model.has(Y) || model.isDimension(Y)) {
        p.x2 = { value: 0 };
      }
    } else {
      if (model.has(X)) { // is ordinal
        p.xc = {
          scale: model.scale(X),
          field: model.field(X)
        };
      } else {
        p.x = { value: 0, offset: 1 };
      }
    }

    // width
    if (!p.x2) {
      if (!model.has(X) || model.isOrdinalScale(X)) { // no X or X is ordinal
        if (model.has(SIZE)) {
          p.width = {
            scale: model.scale(SIZE),
            field: model.field(SIZE)
          };
        } else {
          // FIXME consider using band: true here
          p.width = {
            value: model.fieldDef(X).scale.bandWidth,
            offset: -1
          };
        }
      } else { // X is Quant or Time Scale
        p.width = { value: 2 };
      }
    }

    // y's & height
    if (stack && Y === stack.fieldChannel) {
      p.y = {
        scale: model.scale(Y),
        field: model.field(Y) + '_start'
      };
      p.y2 = {
        scale: model.scale(Y),
        field: model.field(Y) + '_end'
      };
    } else if (model.fieldDef(Y).bin) {
      p.y = {
        scale: model.scale(Y),
        field: model.field(Y, { binSuffix: '_start' })
      };
      p.y2 = {
        scale: model.scale(Y),
        field: model.field(Y, { binSuffix: '_end' }),
        offset: 1
      };
    } else if (model.isMeasure(Y)) {
      p.y = {
        scale: model.scale(Y),
        field: model.field(Y)
      };
      p.y2 = { field: { group: 'height' } };
    } else {
      if (model.has(Y)) { // is ordinal
        p.yc = {
          scale: model.scale(Y),
          field: model.field(Y)
        };
      } else {
        p.y2 = {
          field: { group: 'height' },
          offset: -1
        };
      }

      if (model.has(SIZE)) {
        p.height = {
          scale: model.scale(SIZE),
          field: model.field(SIZE)
        };
      } else {
        // FIXME: band:true?
        p.height = {
          value: model.fieldDef(Y).scale.bandWidth,
          offset: -1
        };
      }
    }

    // fill
    extend(p, colorMixins(model));

    // opacity
    var opacity = model.config('marks', 'opacity');
    if (opacity) { p.opacity = { value: opacity }; };

    return p;
  }

  export function labels(model: Model) {
    // TODO(#64): fill this method
    return undefined;
  }
}

export namespace point {
  export function properties(model: Model) {
    // TODO Use Vega's marks properties interface
    var p: any = {};

    // x
    if (model.has(X)) {
      p.x = {
        scale: model.scale(X),
        field: model.field(X, { binSuffix: '_mid' })
      };
    } else {
      p.x = { value: model.fieldDef(X).scale.bandWidth / 2 };
    }

    // y
    if (model.has(Y)) {
      p.y = {
        scale: model.scale(Y),
        field: model.field(Y, { binSuffix: '_mid' })
      };
    } else {
      p.y = { value: model.fieldDef(Y).scale.bandWidth / 2 };
    }

    // size
    if (model.has(SIZE)) {
      p.size = {
        scale: model.scale(SIZE),
        field: model.field(SIZE)
      };
    } else {
      p.size = { value: model.fieldDef(SIZE).value };
    }

    // shape
    if (model.has(SHAPE)) {
      p.shape = {
        scale: model.scale(SHAPE),
        field: model.field(SHAPE)
      };
    } else {
      p.shape = { value: model.fieldDef(SHAPE).value };
    }

    // fill or stroke
    extend(p, colorMixins(model));

    // opacity
    const opacity = model.config('marks', 'opacity');
    if (opacity) { p.opacity = { value: opacity }; };

    return p;
  }

  export function labels(model: Model) {
    // TODO(#240): fill this method
  }
}

export namespace line {
  export function properties(model: Model) {
    // TODO Use Vega's marks properties interface
    var p: any = {};

    // x
    if (model.has(X)) {
      p.x = {
        scale: model.scale(X),
        field: model.field(X, { binSuffix: '_mid' })
      };
    } else {
      p.x = { value: 0 };
    }

    // y
    if (model.has(Y)) {
      p.y = {
        scale: model.scale(Y),
        field: model.field(Y, { binSuffix: '_mid' })
      };
    } else {
      p.y = { field: { group: 'height' } };
    }

    // stroke
    if (model.has(COLOR)) {
      p.stroke = {
        scale: model.scale(COLOR),
        field: model.field(COLOR)
      };
    } else {
      p.stroke = { value: model.fieldDef(COLOR).value };
    }

    // opacity
    var opacity = model.config('marks', 'opacity');
    if (opacity) { p.opacity = { value: opacity }; };

    p.strokeWidth = { value: model.config('marks').strokeWidth };

    applyMarksConfig(p, model.config('marks'), ['interpolate', 'tension']);

    return p;
  }

  export function labels(model: Model) {
    // TODO(#240): fill this method
    return undefined;
  }
}

export namespace area {
  // TODO(#694): optimize area's usage with bin
  export function properties(model: Model) {
    // TODO Use Vega's marks properties interface
    var p: any = {};

    const orient = model.config('marks', 'orient');
    if (orient !== undefined) {
      p.orient = { value: orient };
    }

    const stack = model.stack();
    // x
    if (stack && X === stack.fieldChannel) { // Stacked Measure
      p.x = {
        scale: model.scale(X),
        field: model.field(X) + '_start'
      };
    } else if (model.isMeasure(X)) { // Measure
      p.x = { scale: model.scale(X), field: model.field(X) };
    } else if (model.isDimension(X)) {
      p.x = {
        scale: model.scale(X),
        field: model.field(X, { binSuffix: '_mid' })
      };
    }

    // x2
    if (orient === 'horizontal') {
      if (stack && X === stack.fieldChannel) {
        p.x2 = {
          scale: model.scale(X),
          field: model.field(X) + '_end'
        };
      } else {
        p.x2 = {
          scale: model.scale(X),
          value: 0
        };
      }
    }

    // y
    if (stack && Y === stack.fieldChannel) { // Stacked Measure
      p.y = {
        scale: model.scale(Y),
        field: model.field(Y) + '_start'
      };
    } else if (model.isMeasure(Y)) {
      p.y = {
        scale: model.scale(Y),
        field: model.field(Y)
      };
    } else if (model.isDimension(Y)) {
      p.y = {
        scale: model.scale(Y),
        field: model.field(Y, { binSuffix: '_mid' })
      };
    }

    if (orient !== 'horizontal') { // 'vertical' or undefined are vertical
      if (stack && Y === stack.fieldChannel) {
        p.y2 = {
          scale: model.scale(Y),
          field: model.field(Y) + '_end'
        };
      } else {
        p.y2 = {
          scale: model.scale(Y),
          value: 0
        };
      }
    }

    // fill
    extend(p, colorMixins(model));

    // opacity
    var opacity = model.config('marks', 'opacity');
    if (opacity) { p.opacity = { value: opacity }; };

    applyMarksConfig(p, model.config('marks'), ['interpolate', 'tension']);

    return p;
  }

  export function labels(model: Model) {
    // TODO(#240): fill this method
    return undefined;
  }
}

export namespace tick {
  export function properties(model: Model) {
    // TODO Use Vega's marks properties interface
    // FIXME are /3 , /1.5 divisions here correct?
    var p: any = {};

    // x
    if (model.has(X)) {
      p.x = {
        scale: model.scale(X),
        field: model.field(X, { binSuffix: '_mid' })
      };
      if (model.isDimension(X)) {
        p.x.offset = -model.fieldDef(X).scale.bandWidth / 3;
      }
    } else {
      p.x = { value: 0 };
    }

    // y
    if (model.has(Y)) {
      p.y = {
        scale: model.scale(Y),
        field: model.field(Y, { binSuffix: '_mid' })
      };
      if (model.isDimension(Y)) {
        p.y.offset = -model.fieldDef(Y).scale.bandWidth / 3;
      }
    } else {
      p.y = { value: 0 };
    }

    // width
    if (!model.has(X) || model.isDimension(X)) {
      // TODO(#694): optimize tick's width for bin
      p.width = { value: model.fieldDef(X).scale.bandWidth / 1.5 };
    } else {
      p.width = { value: 1 };
    }

    // height
    if (!model.has(Y) || model.isDimension(Y)) {
      // TODO(#694): optimize tick's height for bin
      p.height = { value: model.fieldDef(Y).scale.bandWidth / 1.5 };
    } else {
      p.height = { value: 1 };
    }

    // fill
    if (model.has(COLOR)) {
      p.fill = {
        scale: model.scale(COLOR),
        field: model.field(COLOR)
      };
    } else {
      p.fill = { value: model.fieldDef(COLOR).value };
    }

    // opacity
    var opacity = model.config('marks', 'opacity');
    if (opacity) { p.opacity = { value: opacity }; };

    return p;
  }

  export function labels(model: Model) {
    // TODO(#240): fill this method
    return undefined;
  }
}

function filled_point_props(shape) {
  return function(model: Model) {
    // TODO Use Vega's marks properties interface
    var p: any = {};

    // x
    if (model.has(X)) {
      p.x = {
        scale: model.scale(X),
        field: model.field(X, { binSuffix: '_mid' })
      };
    } else {
      p.x = { value: model.fieldDef(X).scale.bandWidth / 2 };
    }

    // y
    if (model.has(Y)) {
      p.y = {
        scale: model.scale(Y),
        field: model.field(Y, { binSuffix: '_mid' })
      };
    } else {
      p.y = { value: model.fieldDef(Y).scale.bandWidth / 2 };
    }

    // size
    if (model.has(SIZE)) {
      p.size = {
        scale: model.scale(SIZE),
        field: model.field(SIZE)
      };
    } else {
      p.size = { value: model.fieldDef(SIZE).value };
    }

    // shape
    p.shape = { value: shape };

    // fill
    if (model.has(COLOR)) {
      p.fill = {
        scale: model.scale(COLOR),
        field: model.field(COLOR)
      };
    } else {
      p.fill = { value: model.fieldDef(COLOR).value };
    }

    // opacity
    var opacity = model.config('marks', 'opacity');
    if (opacity) { p.opacity = { value: opacity }; };

    return p;
  };
}

export namespace circle {
  export const properties = filled_point_props('circle');

  export function labels(model: Model) {
    // TODO(#240): fill this method
    return undefined;
  }
}

export namespace square {
  export const properties = filled_point_props('square');

  export function labels(model: Model) {
    // TODO(#240): fill this method
    return undefined;
  }
}

export namespace text {
  export function background(model: Model) {
    return {
      x: { value: 0 },
      y: { value: 0 },
      width: { field: { group: 'width' } },
      height: { field: { group: 'height' } },
      fill: { scale: model.scale(COLOR), field: model.field(COLOR) }
    };
  }

  export function properties(model: Model) {
    // TODO Use Vega's marks properties interface
    let p: any = {};
    const fieldDef = model.fieldDef(TEXT);
    const marksConfig = model.config('marks');

    // x
    if (model.has(X)) {
      p.x = {
        scale: model.scale(X),
        field: model.field(X, { binSuffix: '_mid' })
      };
    } else {
      if (model.has(TEXT) && model.fieldDef(TEXT).type === QUANTITATIVE) {
        // TODO: make this -5 offset a config
        p.x = { field: { group: 'width' }, offset: -5 };
      } else {
        p.x = { value: model.fieldDef(X).scale.bandWidth / 2 };
      }
    }

    // y
    if (model.has(Y)) {
      p.y = {
        scale: model.scale(Y),
        field: model.field(Y, { binSuffix: '_mid' })
      };
    } else {
      p.y = { value: model.fieldDef(Y).scale.bandWidth / 2 };
    }

    // size
    if (model.has(SIZE)) {
      p.fontSize = {
        scale: model.scale(SIZE),
        field: model.field(SIZE)
      };
    } else {
      p.fontSize = { value: marksConfig.fontSize };
    }

    // fill
    // TODO: consider if color should just map to fill instead?

    // opacity
    var opacity = model.config('marks', 'opacity');
    if (opacity) { p.opacity = { value: opacity }; };

    // text
    if (model.has(TEXT)) {
      if (model.fieldDef(TEXT).type === QUANTITATIVE) {
        // TODO: revise this line
        var numberFormat = marksConfig.format !== undefined ?
          marksConfig.format : model.numberFormat(TEXT);

        p.text = {
          template: '{{' + model.field(TEXT, { datum: true }) +
          ' | number:\'' + numberFormat + '\'}}'
        };
      } else {
        p.text = { field: model.field(TEXT) };
      }
    } else {
      p.text = { value: fieldDef.value };
    }

    applyMarksConfig(p, marksConfig,
      ['angle', 'align', 'baseline', 'dx', 'dy', 'fill', 'font', 'fontWeight',
        'fontStyle', 'radius', 'theta']);

    return p;
  }

  export function labels(model: Model) {
    // TODO(#240): fill this method
    return undefined;
  }
}

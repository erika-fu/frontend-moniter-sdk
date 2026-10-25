# Frontend Monitoring

This context describes the user-visible views and performance measurements represented by the monitoring SDK.

## Language

**Navigation Attempt**:
An initiated transition toward a destination that may be cancelled, redirected, or become a Page View. A redirect chain remains one Navigation Attempt whose timing begins at the original transition.
_Avoid_: Page View, route change

**Page View**:
One concrete presentation of a page to a user, whether created by an initial document navigation or a later client-side navigation. A Navigation Attempt becomes a uniquely identified Page View only when the destination is committed and displayed.
_Avoid_: Route instance, virtual page

**Page Name**:
A stable, application-defined business identity used to aggregate Page Views of the same kind, such as `product-detail`.
_Avoid_: Full URL, page address

**Page URL**:
The sanitized address associated with one Page View and used for individual diagnosis rather than default aggregation.
_Avoid_: Page identity, aggregation key

**Route Pattern**:
A parameterized route identity, such as `/products/:id`, used as the fallback aggregation key when a Page Name is unavailable.
_Avoid_: Full route, raw path

**Document Paint Metric**:
An FCP or LCP measurement scoped to the document lifecycle and sourced from the browser's standard paint semantics.
_Avoid_: Initial-page metric

**View Start**:
The timing origin of a Page View, normally the moment the routing framework confirms that navigation has begun. A lower-fidelity automatic source may use the observed History or URL change instead.
_Avoid_: URL change time, click time

**View Paint Metric**:
An FCP-like or LCP-like measurement scoped to one Page View, with its measurement source retained as part of its meaning.
_Avoid_: Standard Web Vital, route Web Vital

**View First Contentful Paint**:
The elapsed time from View Start until content belonging to the new Page View first becomes visible, excluding retained content, empty placeholders, spinners, and skeleton-only states.
_Avoid_: Route FCP, first render

**View Largest Contentful Paint**:
The elapsed time from View Start until the largest eligible candidate in the Page View's declared above-the-fold content region is painted and the candidate set is finalized.
_Avoid_: Route LCP, key content paint

**Key Content Paint**:
The elapsed time from View Start until an application-declared element central to the Page View becomes visible, regardless of whether it is the largest element.
_Avoid_: View LCP, custom LCP

**Measurement Source**:
The mechanism that determines when content was painted for a View Paint Metric, kept distinct so measurements with different semantics are not assumed to be interchangeable.
_Avoid_: Start source, generic source

**Start Source**:
The mechanism that establishes View Start, independently of the mechanism that detects the later paint.
_Avoid_: Measurement source, generic source

**Metric Coverage**:
The share of measurable Page Views that produced a valid instance of a given View Paint Metric. Missing measurements remain absent rather than becoming zero or timeout-valued samples.
_Avoid_: Success rate, sample rate

/** About page, opened from the footer link (#about). */
export function AboutView() {
  return (
    <section className="panel about">
      <div className="panel-head">
        <h2>About Playoff Planner</h2>
      </div>
      <div className="panel-body">
        <p style={{ margin: 0 }}>
          Playoff Planner was created by Jeff Maser to help fantasy hockey managers optimize their lineups by combining NHL team schedules, roster data, and custom league
          settings. Users can also visualize how trades and free-agent moves would affect their lineups.
        </p>
      </div>
    </section>
  );
}

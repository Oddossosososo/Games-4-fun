#![no_std]

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! { loop {} }

#[no_mangle]
pub extern "C" fn predict_intercept_y(
    ball_y: f64,
    ball_vy: f64,
    time_to_impact: f64,
    field_height: f64,
    ball_radius: f64,
) -> f64 {
    let span = field_height - 2.0 * ball_radius;
    if span <= 0.0 { return field_height * 0.5; }
    let raw = ball_y + ball_vy * time_to_impact;
    let period = 2.0 * span;
    // no_std wasm32 toolchains may not expose f64::rem_euclid.
    let offset = raw - ball_radius;
    let turns = (offset / period) as i64;
    let mut folded = offset - (turns as f64) * period;
    if folded < 0.0 { folded += period; }
    ball_radius + if folded <= span { folded } else { period - folded }
}

#[no_mangle]
pub extern "C" fn clamp_paddle_target(
    intercept_y: f64,
    paddle_height: f64,
    field_height: f64,
) -> f64 {
    (intercept_y - paddle_height * 0.5).max(0.0).min(field_height - paddle_height)
}

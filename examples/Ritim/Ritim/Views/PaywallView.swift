import StoreKit
import SwiftUI

/// "Ritim Plus" subscription offer.
struct PaywallView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(PlusStore.self) private var store
    @ScaledMetric(relativeTo: .largeTitle) private var crownSize: CGFloat = 72

    private var price: String {
        store.product?.displayPrice ?? String(localized: "paywall.fallbackPrice")
    }

    private struct Feature: Identifiable {
        let symbol: String
        let title: LocalizedStringKey
        let detail: LocalizedStringKey
        var id: String { symbol }
    }

    private let features: [Feature] = [
        Feature(symbol: "infinity", title: "Unlimited habits",
                detail: "Track everything that matters to you."),
        Feature(symbol: "chart.xyaxis.line", title: "Advanced statistics",
                detail: "Yearly trends and per-habit insights."),
        Feature(symbol: "bell.badge.fill", title: "Smart reminders",
                detail: "Nudges only on days you haven't checked in."),
        Feature(symbol: "paintpalette.fill", title: "Themes and icons",
                detail: "Make Ritim look and feel like yours."),
    ]

    var body: some View {
        ZStack(alignment: .topTrailing) {
            LinearGradient(colors: [Color("BrandStart"), Color("BrandEnd")], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()

            VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 20) {
                    VStack(spacing: 12) {
                        Image(systemName: "crown.fill")
                            .font(.system(size: crownSize * 0.48, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: crownSize, height: crownSize)
                            .background(.white.opacity(0.18), in: .circle)
                            .accessibilityHidden(true)
                        Text(verbatim: "Ritim Plus")
                            .font(.largeTitle.bold())
                        Text("Build habits that stick, with every tool unlocked.")
                            .font(.title3)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.white.opacity(0.9))
                    }
                    .padding(.top, 12)

                    VStack(spacing: 10) {
                        ForEach(features) { feature in
                            HStack(alignment: .top, spacing: 14) {
                                Image(systemName: feature.symbol)
                                    .font(.title3.weight(.semibold))
                                    .frame(width: 32)
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(feature.title).font(.headline)
                                    Text(feature.detail).font(.subheadline).foregroundStyle(.white.opacity(0.85))
                                }
                                Spacer(minLength: 0)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                    .padding(18)
                    .background(.white.opacity(0.14), in: .rect(cornerRadius: 22, style: .continuous))

                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("Monthly").font(.headline)
                            Spacer()
                            Text("1 week free")
                                .font(.caption.bold())
                                .padding(.horizontal, 10)
                                .padding(.vertical, 4)
                                .background(.white, in: .capsule)
                                .foregroundStyle(Color("BrandStart"))
                        }
                        Text("\(price) / month")
                            .font(.title2.bold())
                    }
                    .padding(18)
                    .background(.white.opacity(0.14), in: .rect(cornerRadius: 22, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .strokeBorder(.white.opacity(0.7), lineWidth: 2)
                    }
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)

                VStack(spacing: 10) {
                    Button {
                        Task { await store.purchase() }
                    } label: {
                        Group {
                            if store.isSubscribed {
                                Text("You're a Plus member")
                            } else {
                                Text("Start free trial")
                            }
                        }
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(.white, in: .capsule)
                        .foregroundStyle(Color("BrandStart"))
                    }
                    .disabled(store.isSubscribed || store.isPurchasing)

                    Text("Then \(price) per month. Renews automatically until cancelled.")
                        .font(.footnote)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.white.opacity(0.85))

                    Button("Restore Purchases") {
                        Task { await store.restore() }
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.white)
                }
                .padding(.horizontal, 24)
                .padding(.top, 12)
                .padding(.bottom, 8)
                .frame(maxWidth: 560)
            }

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(.white.opacity(0.2), in: .circle)
            }
            .accessibilityLabel(Text("Close"))
            .padding(.trailing, 20)
            .padding(.top, 8)
        }
    }
}
